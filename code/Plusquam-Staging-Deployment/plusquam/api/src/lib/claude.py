"""Provider-agnostic LLM client.

The underlying AI is config-driven so it can be switched without touching the
pipeline. Provider is chosen by the LLM_PROVIDER env var:
  - "groq"      : Groq OpenAI-compatible API (free tier, e.g. llama-3.3-70b-versatile)
  - "dashscope" : Alibaba DashScope OpenAI-compatible mode (qwen-plus) — the
                  provider/model the accuracy evaluation was run against
  - "gemini"    : Google Gemini generateContent (free tier)
  - "anthropic" : Anthropic SDK

The API key is read from Secrets Manager (same secret id regardless of provider,
so switching providers only needs the secret value + env vars updated).
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
from typing import Any
from urllib.request import Request, urlopen

import boto3

PROVIDER = os.environ.get("LLM_PROVIDER", "groq").lower()
DEFAULT_MODEL = os.environ.get(
    "LLM_MODEL",
    os.environ.get("CLAUDE_MODEL", "llama-3.3-70b-versatile"),
)

# Sampling temperature. 0.3 matches the accuracy evaluation; set LLM_TEMPERATURE=0
# for reproducible runs (same input -> same verdict).
try:
    TEMPERATURE = float(os.environ.get("LLM_TEMPERATURE", "0.3"))
except ValueError:
    TEMPERATURE = 0.3

_secrets = boto3.client("secretsmanager")
_api_key: str | None = None
_anthropic_client = None


def _get_api_key() -> str:
    global _api_key
    if _api_key is None:
        secret_name = os.environ.get("LLM_SECRET_NAME") or os.environ.get("MODEL_PROVIDER_SECRET_NAME") or os.environ.get("ANTHROPIC_SECRET_NAME")
        if not secret_name:
            raise RuntimeError("LLM provider secret is not configured")
        r = _secrets.get_secret_value(SecretId=secret_name)
        _api_key = r["SecretString"].strip()
    return _api_key


# ─── transport with retry/backoff (free tiers throttle with 429s) ──────────────
_RETRY_STATUS = {429, 500, 502, 503, 504}


def _retry_after(e: urllib.error.HTTPError) -> float | None:
    try:
        v = e.headers.get("Retry-After")
        return float(v) if v else None
    except Exception:
        return None


def _post_json(url: str, headers: dict, payload: dict, attempts: int = 5, timeout: int = 120) -> dict:
    body = json.dumps(payload).encode()
    # A real User-Agent is required: urllib's default ("Python-urllib/x") is
    # blocked by Cloudflare bot protection in front of some providers (HTTP 403,
    # Cloudflare code 1010). Accept/UA make the request look like a normal client.
    hdrs = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; plusquam-assessment/1.0; +https://plusquam.xyz)",
        **headers,
    }
    last: Exception | None = None
    for i in range(attempts):
        try:
            with urlopen(Request(url, data=body, headers=hdrs, method="POST"), timeout=timeout) as resp:
                raw = resp.read(4 * 1024 * 1024 + 1)
                if len(raw) > 4 * 1024 * 1024:
                    raise RuntimeError("LLM response exceeds size limit")
                return json.loads(raw)
        except urllib.error.HTTPError as e:
            last = e
            if e.code not in _RETRY_STATUS:
                print(f"LLM provider returned HTTP {e.code}")
                raise
            print(f"LLM provider returned retryable HTTP {e.code}")
            wait = _retry_after(e) or (2 ** i)
        except urllib.error.URLError as e:
            last = e
            wait = 2 ** i
        if i < attempts - 1:
            time.sleep(min(wait, 20))
    raise RuntimeError(f"LLM provider unavailable after {attempts} attempts") from None


def _parse_json(text: str) -> Any:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        raise ValueError("model returned invalid JSON") from None


# ─── public interface (unchanged signature) ───────────────────────────────────
def complete(
    *,
    system: str,
    user: str,
    model: str | None = None,
    max_tokens: int = 4096,
    expect_json: bool = False,
) -> Any:
    """Run a single completion against the configured provider.

    If ``expect_json`` is True the response is parsed into Python before return.
    """
    model = model or DEFAULT_MODEL
    user_content = (
        f"{user}\n\nReturn ONLY valid JSON. No prose, no code fences, no commentary."
        if expect_json else user
    )
    # JSON schemas here (esp. scoring) can be large — give them room.
    tokens = max(max_tokens, 8000) if expect_json else max_tokens

    if PROVIDER == "groq":
        text = _groq(system, user_content, model, tokens, expect_json)
    elif PROVIDER == "dashscope":
        text = _dashscope(system, user_content, model, tokens, expect_json)
    elif PROVIDER == "gemini":
        text = _gemini(system, user_content, model, tokens, expect_json)
    else:
        text = _anthropic(system, user_content, model, max_tokens)

    return _parse_json(text) if expect_json else text.strip()


# ─── providers ────────────────────────────────────────────────────────────────
def _openai_compat(
    url: str, system: str, user: str, model: str, max_tokens: int,
    expect_json: bool, extra: dict | None = None,
) -> str:
    """Shared OpenAI-compatible chat/completions call (Groq, DashScope, …)."""
    payload: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "max_tokens": max_tokens,
        "temperature": TEMPERATURE,
    }
    if expect_json:
        payload["response_format"] = {"type": "json_object"}
    if extra:
        payload.update(extra)
    data = _post_json(url, {"Authorization": f"Bearer {_get_api_key()}"}, payload)
    return (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""


def _groq(system: str, user: str, model: str, max_tokens: int, expect_json: bool) -> str:
    # Qwen3 models on Groq are reasoning models; disable thinking so we get clean
    # JSON fast (this is structured extraction, not open-ended reasoning).
    extra = {"reasoning_effort": "none"} if "qwen" in model.lower() else None
    return _openai_compat(
        "https://api.groq.com/openai/v1/chat/completions",
        system, user, model, max_tokens, expect_json, extra,
    )


def _dashscope(system: str, user: str, model: str, max_tokens: int, expect_json: bool) -> str:
    """Alibaba DashScope (international), OpenAI-compatible mode.

    This is the provider the accuracy evaluation was run against (qwen-plus), so
    pointing production here makes the live pipeline match the tested setup.
    """
    return _openai_compat(
        "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
        system, user, model, max_tokens, expect_json,
    )


def _gemini(system: str, user: str, model: str, max_tokens: int, expect_json: bool) -> str:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    gen: dict = {"maxOutputTokens": max_tokens, "temperature": 0.3}
    if expect_json:
        gen["responseMimeType"] = "application/json"
    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": gen,
    }
    data = _post_json(url, {"x-goog-api-key": _get_api_key()}, payload)
    cands = data.get("candidates") or []
    parts = (cands[0].get("content", {}).get("parts") if cands else []) or []
    return "".join(p.get("text", "") for p in parts)


def _anthropic(system: str, user: str, model: str, max_tokens: int) -> str:
    from anthropic import Anthropic
    global _anthropic_client
    if _anthropic_client is None:
        _anthropic_client = Anthropic(api_key=_get_api_key())
    res = _anthropic_client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    return "\n".join(
        block.text for block in res.content if getattr(block, "type", None) == "text"
    )
