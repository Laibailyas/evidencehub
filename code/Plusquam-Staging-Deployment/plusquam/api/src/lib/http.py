"""HTTP response helpers: ok/err builders, body parser, CORS.

CORS is handled in Lambda (not API Gateway), because AWS::Serverless::HttpApi's
CorsConfiguration doesn't reliably apply to explicit HttpApi resources. Every
response carries CORS headers, and a catch-all OPTIONS route (see template.yaml →
CorsFunction) answers preflight requests via preflight().

Wildcard origin is fine here: auth is a Bearer token in a header (not a cookie),
so requests don't use credentials mode. Tighten to a reflected allow-list for prod.
"""

from __future__ import annotations

import json
import os
from contextvars import ContextVar
from decimal import Decimal
from typing import Any

_request_origin: ContextVar[str | None] = ContextVar("request_origin", default=None)
_ALLOWED_ORIGINS = {
    origin.strip().rstrip("/")
    for origin in os.environ.get(
        "CORS_ALLOWED_ORIGINS",
        "https://intel.plusquam.xyz,https://apppq.plusquam.xyz",
    ).split(",")
    if origin.strip()
}


def set_request_origin(event: dict) -> None:
    origin = ((event.get("headers") or {}).get("origin")
              or (event.get("headers") or {}).get("Origin") or "").rstrip("/")
    _request_origin.set(origin if origin in _ALLOWED_ORIGINS else None)


def _cors_headers() -> dict[str, str]:
    headers = {
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age":       "600",
    "Vary": "Origin",
    }
    origin = _request_origin.get()
    if origin:
        headers["Access-Control-Allow-Origin"] = origin
    return headers

def preflight(event: dict | None = None) -> dict:
    """204 response for CORS preflight (OPTIONS)."""
    if event is not None:
        set_request_origin(event)
    return {"statusCode": 204, "headers": _cors_headers(), "body": ""}


class _DecimalEncoder(json.JSONEncoder):
    """DynamoDB returns numbers as Decimal — make them JSON-serialisable."""

    def default(self, o: Any) -> Any:
        if isinstance(o, Decimal):
            return int(o) if o % 1 == 0 else float(o)
        return super().default(o)


def ok(body: Any, status: int = 200) -> dict:
    return {
        "statusCode": status,
        "headers":    {"Content-Type": "application/json", **_cors_headers()},
        "body":       json.dumps(body, cls=_DecimalEncoder),
    }


def err(message: str, status: int = 400) -> dict:
    return ok({"error": message}, status)


def binary(data: bytes, content_type: str, filename: str | None = None, status: int = 200) -> dict:
    """Return a base64 binary response (e.g. a PDF). API Gateway HTTP API decodes
    the body when isBase64Encoded is true. Carries CORS headers like ok()/err()."""
    import base64

    headers = {"Content-Type": content_type, **_cors_headers()}
    if filename:
        headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return {
        "statusCode":      status,
        "headers":         headers,
        "body":            base64.b64encode(data).decode("ascii"),
        "isBase64Encoded": True,
    }


def parse_body(event: dict) -> dict:
    raw = event.get("body")
    if not raw:
        return {}
    if not isinstance(raw, str) or len(raw.encode("utf-8", errors="ignore")) > 8 * 1024 * 1024:
        return {}
    if event.get("isBase64Encoded"):
        try:
            import base64
            raw = base64.b64decode(raw).decode("utf-8")
        except Exception:
            return {}
    try:
        value = json.loads(raw)
        return value if isinstance(value, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}
