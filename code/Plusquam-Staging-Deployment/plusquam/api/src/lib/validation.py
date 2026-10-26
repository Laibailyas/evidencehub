"""Small, dependency-free validators for structured model responses."""

from __future__ import annotations

from typing import Any


class ModelOutputError(ValueError):
    pass


def _object(value: Any, label: str) -> dict:
    if not isinstance(value, dict):
        raise ModelOutputError(f"invalid {label} output")
    return value


def _text(value: Any, label: str, maximum: int = 8_000) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ModelOutputError(f"invalid {label} output")
    return value.strip()


def _score(value: Any, maximum: int, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= maximum:
        raise ModelOutputError(f"invalid {label} output")
    return value


def _refs(value: Any, paper_count: int, label: str) -> list[int]:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 30:
        raise ModelOutputError(f"invalid {label} output")
    if any(isinstance(ref, bool) or not isinstance(ref, int) or not 1 <= ref <= paper_count for ref in value):
        raise ModelOutputError(f"invalid {label} output")
    return value


def validate_query_profile(value: Any) -> dict:
    obj = _object(value, "query profile")
    domain = _text(obj.get("domain"), "query profile", 300)
    terms = obj.get("technicalTerms")
    if not isinstance(terms, list) or not 1 <= len(terms) <= 20:
        raise ModelOutputError("invalid query profile output")
    terms = [_text(term, "query profile", 120) for term in terms]
    query = _text(obj.get("searchQuery"), "query profile", 500)
    return {"domain": domain, "technicalTerms": terms, "searchQuery": query}


def validate_open_questions(value: Any, paper_count: int) -> list[dict]:
    if not isinstance(value, list) or not 1 <= len(value) <= 10:
        raise ModelOutputError("invalid open questions output")
    result = []
    for item in value:
        obj = _object(item, "open questions")
        result.append({
            "question": _text(obj.get("question"), "open questions", 2_000),
            "paperRefs": _refs(obj.get("paperRefs", []), paper_count, "open questions"),
            "fzulgRelevance": _text(obj.get("fzulgRelevance"), "open questions", 2_000),
        })
    return result


def validate_scoring(value: Any, paper_count: int) -> dict:
    obj = _object(value, "scoring")
    fit_score = _score(obj.get("fitScore"), 100, "scoring")

    einordnung = _object(obj.get("einordnung"), "scoring")
    verdicts = {"qualifies", "borderline", "not_qualifies"}
    verdict = einordnung.get("verdict")
    if not isinstance(verdict, str) or verdict not in verdicts:
        raise ModelOutputError("invalid scoring output")
    paragraphs = einordnung.get("paragraphs")
    if not isinstance(paragraphs, list) or len(paragraphs) > 20:
        raise ModelOutputError("invalid scoring output")
    einordnung_clean = {
        "verdict": verdict,
        "justification": _text(einordnung.get("justification"), "scoring", 4_000),
        "paragraphs": [_text(p, "scoring", 200) for p in paragraphs],
    }

    names = {"Neuartigkeit", "Technisches Risiko", "Systematik", "Planmäßigkeit", "Wissenschaftliche Ungewissheit"}
    levels = {"strong", "fulfilled", "weak", "not_fulfilled"}
    matrix = obj.get("passformMatrix")
    if not isinstance(matrix, list) or len(matrix) != 5:
        raise ModelOutputError("invalid scoring output")
    matrix_clean = []
    for row in matrix:
        row = _object(row, "scoring")
        if (not isinstance(row.get("name"), str) or row.get("name") not in names
                or not isinstance(row.get("level"), str) or row.get("level") not in levels):
            raise ModelOutputError("invalid scoring output")
        matrix_clean.append({"name": row["name"], "level": row["level"], "evidence": _text(row.get("evidence"), "scoring", 2_000)})
    if {row["name"] for row in matrix_clean} != names:
        raise ModelOutputError("invalid scoring output")

    claims = obj.get("anspruchstabelle")
    if not isinstance(claims, list) or len(claims) > 30:
        raise ModelOutputError("invalid scoring output")
    claims_clean = []
    for claim in claims:
        claim = _object(claim, "scoring")
        if not isinstance(claim.get("evidence"), str) or claim.get("evidence") not in {"strong", "moderate", "low"}:
            raise ModelOutputError("invalid scoring output")
        cleaned = {
            "claim": _text(claim.get("claim"), "scoring", 2_000),
            "evidence": claim["evidence"],
            "paperRefs": _refs(claim.get("paperRefs", []), paper_count, "scoring"),
            "reasoning": _text(claim.get("reasoning"), "scoring", 3_000),
        }
        if "legalRefs" in claim:
            refs = claim["legalRefs"]
            if not isinstance(refs, list) or len(refs) > 20:
                raise ModelOutputError("invalid scoring output")
            cleaned["legalRefs"] = [_text(ref, "scoring", 200) for ref in refs]
        claims_clean.append(cleaned)

    novelty = _object(obj.get("neuheitsgrad"), "scoring")
    dimensions = novelty.get("dimensions")
    keys = {"technical", "methodological", "uncertainty", "systematic", "outcomes"}
    if not isinstance(dimensions, list) or len(dimensions) != 5:
        raise ModelOutputError("invalid scoring output")
    dimensions_clean = []
    for dimension in dimensions:
        dimension = _object(dimension, "scoring")
        if not isinstance(dimension.get("key"), str) or dimension.get("key") not in keys:
            raise ModelOutputError("invalid scoring output")
        row = {
            "key": dimension["key"],
            "score": _score(dimension.get("score"), 20, "scoring"),
            "rationale": _text(dimension.get("rationale"), "scoring", 2_000),
        }
        if "paperRefs" in dimension:
            row["paperRefs"] = _refs(dimension["paperRefs"], paper_count, "scoring")
        dimensions_clean.append(row)
    if {dimension["key"] for dimension in dimensions_clean} != keys:
        raise ModelOutputError("invalid scoring output")

    fazit = _object(obj.get("fazit"), "scoring")
    recommendation = fazit.get("recommendation")
    if not isinstance(recommendation, str) or recommendation not in verdicts:
        raise ModelOutputError("invalid scoring output")
    def strings(key: str) -> list[str]:
        value_list = fazit.get(key)
        if not isinstance(value_list, list) or len(value_list) > 30:
            raise ModelOutputError("invalid scoring output")
        return [_text(x, "scoring", 2_000) for x in value_list]

    return {
        "fitScore": fit_score,
        "einordnung": einordnung_clean,
        "passformMatrix": matrix_clean,
        "anspruchstabelle": claims_clean,
        "neuheitsgrad": {
            "overall": _score(novelty.get("overall"), 100, "scoring"),
            "dimensions": dimensions_clean,
        },
        "fazit": {
            "recommendation": recommendation,
            "strengths": strings("strengths"),
            "risks": strings("risks"),
            "documentationChecklist": strings("documentationChecklist"),
        },
    }
