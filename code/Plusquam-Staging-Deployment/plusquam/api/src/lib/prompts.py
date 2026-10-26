"""Pipeline prompts: hardcoded defaults + admin-editable overrides.

The 4 system prompts used by the assessment pipeline live here as defaults.
Admins can override any of them via the prompt-editor UI; overrides are stored
on the projects table (pk=CONFIG, sk=PROMPTS) and read through at pipeline start
with a fallback to these defaults, so an empty/missing override never breaks the
pipeline.
"""

from __future__ import annotations

from lib.ddb import get_prompts

from lib.prompt_defaults import DEFAULT_PROMPTS, PROMPT_KEYS, SECURITY_PREAMBLE  # noqa: F401  (re-exported)


def effective_prompts() -> dict[str, str]:
    """Defaults merged with stored overrides. A blank/absent override for any
    key falls back to the default. Never raises — a DDB failure yields defaults."""
    try:
        stored = get_prompts() or {}
    except Exception as e:  # pragma: no cover — defensive
        print(f"prompts: override read failed, using defaults (type={type(e).__name__})")
        stored = {}

    merged = dict(DEFAULT_PROMPTS)
    for key in PROMPT_KEYS:
        val = stored.get(key)
        if isinstance(val, str) and val.strip():
            merged[key] = val
    # Prepend the always-on security layer to every prompt (incl. overrides).
    for key in merged:
        merged[key] = f"{SECURITY_PREAMBLE}\n\n{merged[key]}"
    return merged
