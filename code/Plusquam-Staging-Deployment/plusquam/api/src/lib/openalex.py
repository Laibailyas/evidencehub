"""OpenAlex client. Free, no API key — we polite-pool with a mailto.

Docs: https://docs.openalex.org/api-entities/works/search-works
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

POLITE_EMAIL = os.environ.get("OPENALEX_EMAIL", "team@plusquam.app")

# OpenAlex occasionally returns transient 5xx/429s. Retry those with backoff
# instead of failing the whole assessment on a momentary blip.
_RETRY_STATUS = {429, 500, 502, 503, 504}
_MAX_ATTEMPTS = 5


def _retry_after_seconds(e: urllib.error.HTTPError) -> float | None:
    try:
        v = e.headers.get("Retry-After")
        return float(v) if v else None
    except Exception:
        return None


def _get_json(url: str, headers: dict) -> dict:
    """GET a JSON URL with exponential backoff on transient errors."""
    last_err: Exception | None = None
    for attempt in range(_MAX_ATTEMPTS):
        try:
            with urlopen(Request(url, headers=headers), timeout=30) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code not in _RETRY_STATUS:
                raise
            wait = _retry_after_seconds(e) or (2 ** attempt)
        except urllib.error.URLError as e:  # transient network / DNS
            last_err = e
            wait = 2 ** attempt
        if attempt < _MAX_ATTEMPTS - 1:
            time.sleep(min(wait, 20))
    raise RuntimeError(
        f"OpenAlex unavailable after {_MAX_ATTEMPTS} attempts: {last_err}"
    )


def search_works(query: str, *, per_page: int = 10, from_year: int = 2020) -> list[dict]:
    params = {
        "search":   query,
        "per_page": str(per_page),
        "filter":   f"from_publication_date:{from_year}-01-01,has_abstract:true",
        "sort":     "relevance_score:desc",
        "mailto":   POLITE_EMAIL,
    }
    url = "https://api.openalex.org/works?" + urlencode(params)
    data = _get_json(url, {"User-Agent": f"plusquam/0.1 ({POLITE_EMAIL})"})

    results: list[dict] = []
    for idx, w in enumerate(data.get("results", []), start=1):
        authorships = (w.get("authorships") or [])[:3]
        authors = ", ".join(
            a.get("author", {}).get("display_name", "")
            for a in authorships
            if a.get("author", {}).get("display_name")
        )
        primary_location = w.get("primary_location") or {}
        open_access      = w.get("open_access") or {}

        results.append({
            "id":         idx,                       # 1-based ref used in the report
            "openalexId": w.get("id"),
            "title":      w.get("title") or w.get("display_name") or "",
            "authors":    authors,
            "year":       w.get("publication_year"),
            "citations":  w.get("cited_by_count", 0),
            "abstract":   _reconstruct_abstract(w.get("abstract_inverted_index")),
            "type":       _guess_type(w),
            "doi":        w.get("doi"),
            "pdfUrl":     open_access.get("oa_url") or primary_location.get("pdf_url"),
        })
    return results


def _reconstruct_abstract(inverted: dict[str, list[int]] | None) -> str:
    """OpenAlex stores abstracts as inverted indices to comply with publisher TOS. Reconstruct."""
    if not inverted:
        return ""
    positions: dict[int, str] = {}
    for word, idxs in inverted.items():
        for i in idxs:
            positions[i] = word
    return " ".join(positions[i] for i in sorted(positions))


def _guess_type(w: dict[str, Any]) -> str:
    t = (w.get("type") or "").lower()
    if "review" in t:
        return "review"
    if (w.get("cited_by_count") or 0) > 100:
        return "highly_cited"
    return "experimental"
