"""The 7-step assessment pipeline (asynchronous).

Routes:
  POST  /projects/{id}/assess      — kick off the pipeline; returns 202 immediately
  GET   /projects/{id}/status      — poll for per-step progress
  GET   /projects/{id}/assessment  — fetch the completed assessment

The actual pipeline runs in a *separate* async invocation of this same function
(self-invoke with InvocationType='Event'), because it takes ~60s — well over the
API Gateway 30-second limit. The HTTP POST returns 202 in <1s; the worker writes
per-step progress to DynamoDB, which the frontend polls via GET /status.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
from typing import Any

import boto3

from lib.auth import get_claims, is_admin
from lib.claude import complete
from lib.ddb import (
    acquire_assessment_lock, check_rate_limit, find_project_by_id,
    get_assessment, get_project, get_status, put_assessment, put_project,
    release_assessment_lock, update_step_status,
)
from lib.http import binary, err, ok, set_request_origin
from lib.openalex import search_works
from lib.prompts import effective_prompts, SECURITY_PREAMBLE
from lib.pdf_report import render_assessment_pdf
from lib.validation import validate_open_questions, validate_query_profile, validate_scoring

_lambda = boto3.client("lambda")
SELF_FUNCTION_NAME = os.environ.get("AWS_LAMBDA_FUNCTION_NAME", "")


def lambda_handler(event: dict, _context) -> dict:
    # ── Async worker path: this invocation IS the pipeline ──
    if event.get("_pipeline"):
        _run_pipeline(event["userId"], event["projectId"], event.get("leaseId", ""))
        return {"ok": True}

    # ── HTTP path ──
    set_request_origin(event)
    method  = event.get("requestContext", {}).get("http", {}).get("method")
    path    = event.get("requestContext", {}).get("http", {}).get("path", "")
    proj_id = (event.get("pathParameters") or {}).get("id")

    claims = get_claims(event)
    if not claims:
        return err("unauthorized", 401)
    user_id = claims["sub"]

    try:
        if method == "POST" and path.endswith("/assess"):
            return _start_assessment(user_id, proj_id)
        if method == "GET" and path.endswith("/status"):
            if not _authorized_project(user_id, proj_id, claims):
                return err("not found", 404)
            return ok(get_status(proj_id))
        if method == "GET" and path.endswith("/report.pdf"):
            return _report_pdf(user_id, proj_id, event, claims)
        if method == "GET" and path.endswith("/assessment"):
            if not _authorized_project(user_id, proj_id, claims):
                return err("not found", 404)
            a = get_assessment(proj_id)
            return ok(a) if a else err("not ready", 404)
        return err("not found", 404)
    except Exception as e:
        print(f"assessment handler failure requestId={event.get('requestContext', {}).get('requestId', 'unknown')} type={type(e).__name__}")
        return err("internal error", 500)


# ─── Report PDF ────────────────────────────────────────────────

def _authorized_project(user_id: str, project_id: str, claims: dict) -> dict | None:
    project = get_project(user_id, project_id)
    if project or not is_admin(claims):
        return project
    item = find_project_by_id(project_id)
    return item


def _report_pdf(user_id: str, project_id: str, event: dict, claims: dict) -> dict:
    project = _authorized_project(user_id, project_id, claims)
    if not project:
        return err("project not found", 404)
    assessment = get_assessment(project_id)
    if not assessment:
        return err("assessment not ready", 404)

    qs = event.get("queryStringParameters") or {}
    lang = (qs.get("lang") or "de").lower()
    pdf_bytes = render_assessment_pdf(project, assessment, lang)
    slug = _slug(project.get("title") or project_id)
    return binary(pdf_bytes, "application/pdf", f"plusquam-{slug}-{lang}.pdf")


def _slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-")
    return (s[:60] or "report")


# ─── Start: fire the worker, return immediately ────────────────

def _start_assessment(user_id: str, project_id: str) -> dict:
    project = get_project(user_id, project_id)
    if not project:
        return err("project not found", 404)

    user_key = hashlib.sha256(user_id.encode("utf-8")).hexdigest()
    try:
        check_rate_limit(f"assessment-user#{user_key}", limit=5, window_seconds=900)
    except Exception as exc:
        from lib.ddb import RateLimitExceeded
        if isinstance(exc, RateLimitExceeded):
            return err("too many assessment requests; try again later", 429)
        raise

    lease_id = secrets.token_hex(16)
    if not acquire_assessment_lock(project_id, lease_id):
        return err("assessment is already running", 409)

    # Close the delete/start race: deletion checks the same lock before removing
    # the project, and this fresh read rejects a project already removed.
    project = get_project(user_id, project_id)
    if not project:
        release_assessment_lock(project_id, lease_id)
        return err("project not found", 404)

    try:
        # Reset state so (re)runs show as processing rather than a stale error/score.
        project["status"] = "processing"
        project.pop("error", None)
        put_project(project)
        update_step_status(project_id, 1, "running")

        # Fire the pipeline as a separate async invocation of this function.
        _lambda.invoke(
            FunctionName=SELF_FUNCTION_NAME,
            InvocationType="Event",  # async, fire-and-forget
            Payload=json.dumps({"_pipeline": True, "userId": user_id, "projectId": project_id, "leaseId": lease_id}).encode(),
        )
    except Exception:
        try:
            release_assessment_lock(project_id, lease_id)
            project["status"] = "error"
            project["error"] = "assessment_failed"
            put_project(project)
            update_step_status(project_id, 1, "error", {"code": "assessment_failed"})
        except Exception:
            pass
        raise

    return ok({"status": "started", "projectId": project_id}, 202)


# ─── Worker: the actual 7-step pipeline ────────────────────────

def _run_pipeline(user_id: str, project_id: str, lease_id: str) -> None:
    current = 0
    try:
        project = get_project(user_id, project_id)
        if not project:
            update_step_status(project_id, 1, "error", {"message": "project not found"})
            return

        def step(n: int, status: str, payload: Any = None) -> None:
            update_step_status(project_id, n, status, payload)

        # Load prompts (admin overrides merged over defaults; safe fallback).
        prompts = effective_prompts()

        # If a document was uploaded, fold its extracted text into the context
        # used by the pipeline — without persisting it back onto the record.
        ctx_project = project
        source = (project.get("sourceText") or "").strip()
        if source:
            ctx_project = {
                **project,
                "description": (project.get("description", "")
                                + "\n\n[Excerpt from uploaded document]\n" + source),
            }

        # 1 — Query understanding
        current = 1
        step(1, "running")
        query_profile = validate_query_profile(complete(
            system=prompts["query_understanding"],
            user=f"Project title: {ctx_project['title']}\n\nDescription: {ctx_project['description']}",
            expect_json=True,
        ))
        step(1, "done", query_profile)

        # 2 — Legal context (static for the demo; replace with FZulG corpus retrieval)
        current = 2
        step(2, "running")
        legal_context = LEGAL_CONTEXT_SNAPSHOT
        step(2, "done", {"paragraphsRetrieved": len(legal_context)})

        # 3 — Literature retrieval
        current = 3
        step(3, "running")
        papers = search_works(query_profile["searchQuery"], per_page=10)
        step(3, "done", {"count": len(papers)})

        # 4 — State of research synthesis
        current = 4
        step(4, "running")
        literatur_uberblick = complete(
            system=prompts["synthesis"],
            user=_build_papers_context(papers, ctx_project),
        )
        if not isinstance(literatur_uberblick, str) or not literatur_uberblick.strip() or len(literatur_uberblick) > 30_000:
            raise ValueError("invalid synthesis output")
        step(4, "done", {"chars": len(literatur_uberblick)})

        # 5 — Open question identification
        current = 5
        step(5, "running")
        forschungsluecken = validate_open_questions(complete(
            system=prompts["open_questions"],
            user=_build_papers_context(papers, ctx_project),
            expect_json=True,
        ), len(papers))
        step(5, "done", {"count": len(forschungsluecken)})

        # 6 — Novelty scoring (5 dimensions)
        current = 6
        step(6, "running")
        scoring = validate_scoring(complete(
            system=prompts["novelty_scoring"],
            user=_build_scoring_context(papers, ctx_project, query_profile),
            expect_json=True,
        ), len(papers))
        step(6, "done", {"overall": scoring["neuheitsgrad"]["overall"]})

        # 7 — Compile assessment
        current = 7
        step(7, "running")
        assessment = {
            "projectId":          project_id,
            "fitScore":           scoring["fitScore"],
            "einordnung":         scoring["einordnung"],
            "passformMatrix":     scoring["passformMatrix"],
            "literaturUberblick": literatur_uberblick,
            "anspruchstabelle":   scoring["anspruchstabelle"],
            "forschungsluecken":  forschungsluecken,
            "neuheitsgrad":       scoring["neuheitsgrad"],
            "fazit":              scoring["fazit"],
            "papers": [
                {
                    "id":           p["id"],
                    "title":        p["title"],
                    "authors":      p["authors"],
                    "year":         p["year"],
                    "citations":    p["citations"],
                    "type":         p["type"],
                    "pdfUrl":       p["pdfUrl"],
                    "sourceUrl":    p.get("doi") or p["pdfUrl"] or p.get("openalexId"),
                    "keyTakeaway":  p["abstract"][:240],
                    "relevance":    max(0.05, 0.95 - p["id"] * 0.03),  # placeholder; real ranking from OpenAlex score
                }
                for p in papers
            ],
        }

        # Bilingual report content: English is generated above; translate the
        # prose fields to German in one call. Stored as a path-keyed overlay the
        # frontend applies per language. Failure degrades to English (de = en).
        assessment["content"] = _build_bilingual_content(assessment)

        put_assessment(project_id, assessment)

        # Stamp the project record so the dashboard list can show status + score
        # without an extra per-row assessment fetch.
        project["status"] = "complete"
        project["noveltyScore"] = scoring["neuheitsgrad"]["overall"]
        project["fitScore"] = scoring["fitScore"]
        put_project(project)

        step(7, "done")

    except Exception as e:
        print(f"pipeline failure projectId={project_id} step={current} type={type(e).__name__}")
        # Do NOT expose internal details (service names, HTTP errors) to the client.
        update_step_status(project_id, max(current, 1), "error", {"code": "assessment_failed"})
        # Don't leave the project stuck on "processing" — mark it failed so the
        # dashboard reflects it and the user can retry rather than waiting forever.
        try:
            p = get_project(user_id, project_id)
            if p:
                p["status"] = "error"
                p["error"] = "assessment_failed"
                put_project(p)
        except Exception:
            pass
    finally:
        if lease_id:
            try:
                release_assessment_lock(project_id, lease_id)
            except Exception:
                print(f"assessment lock release failed projectId={project_id}")


# ─── Helpers ───────────────────────────────────────────────────

# Infrastructure prompt (not part of the admin-editable pipeline prompts).
TRANSLATION_SYSTEM = SECURITY_PREAMBLE + """

You are a professional technical translator for German R&D tax-credit (FZulG) assessments.
You receive a JSON object whose values are English text fragments from an assessment report.
Translate every value into formal, professional German suitable for a Gutachten.
Rules:
- Return a JSON object with EXACTLY the same keys (do not translate or alter keys).
- Translate values only.
- Preserve inline citation markers like [1], [2] and legal references like §2 FZulG verbatim.
- Keep author names and proper nouns unchanged; keep established German FZulG terminology.
- Return only valid JSON.
""".rstrip()


def _collect_translatable(a: dict) -> dict:
    """Flatten the assessment's prose fields into a path-keyed map. Paths match
    the frontend overlay (dot-separated, numeric segments = array indices)."""
    out: dict[str, str] = {}

    def put(path: str, val: Any) -> None:
        if isinstance(val, str) and val.strip():
            out[path] = val

    put("einordnung.justification", a.get("einordnung", {}).get("justification"))
    for i, row in enumerate(a.get("passformMatrix", [])):
        put(f"passformMatrix.{i}.evidence", row.get("evidence"))
    put("literaturUberblick", a.get("literaturUberblick"))
    for i, row in enumerate(a.get("anspruchstabelle", [])):
        put(f"anspruchstabelle.{i}.claim", row.get("claim"))
        put(f"anspruchstabelle.{i}.reasoning", row.get("reasoning"))
    for i, row in enumerate(a.get("forschungsluecken", [])):
        put(f"forschungsluecken.{i}.question", row.get("question"))
        put(f"forschungsluecken.{i}.fzulgRelevance", row.get("fzulgRelevance"))
    for i, row in enumerate(a.get("neuheitsgrad", {}).get("dimensions", [])):
        put(f"neuheitsgrad.dimensions.{i}.rationale", row.get("rationale"))
    faz = a.get("fazit", {})
    for i, s in enumerate(faz.get("strengths", [])):
        put(f"fazit.strengths.{i}", s)
    for i, s in enumerate(faz.get("risks", [])):
        put(f"fazit.risks.{i}", s)
    for i, s in enumerate(faz.get("documentationChecklist", [])):
        put(f"fazit.documentationChecklist.{i}", s)
    return out


def _build_bilingual_content(assessment: dict) -> dict:
    """Return {"en": <bundle>, "de": <bundle>} of prose strings. German is a
    single translation call; any failure or missing key falls back to English."""
    en = _collect_translatable(assessment)
    content = {"en": en, "de": dict(en)}
    if not en:
        return content
    try:
        de = complete(
            system=TRANSLATION_SYSTEM,
            user=(
                "Translate the VALUES of this JSON object to German and return a "
                "JSON object with the SAME keys:\n\n"
                + json.dumps(en, ensure_ascii=False)
            ),
            expect_json=True,
        )
        if (not isinstance(de, dict) or set(de) != set(en)
                or any(not isinstance(value, str) or len(value) > 8_000 for value in de.values())):
            raise ValueError("invalid translation output")
        content["de"] = {
            k: (de[k] if de[k].strip() else v)
            for k, v in en.items()
        }
    except Exception as e:  # never fail the assessment over translation
        print(f"translation step failed type={type(e).__name__}; German falls back to English")
    return content


def _build_papers_context(papers: list[dict], project: dict) -> str:
    parts = [
        f"PROJECT:\nTitle: {project['title']}\nDescription: {project['description']}\n",
        "PAPERS:",
    ]
    parts.extend(
        f"[{p['id']}] {p['title']} ({p['year']}, {p['citations']} citations)\n{p['abstract']}\n"
        for p in papers
    )
    return "\n".join(parts)


def _build_scoring_context(papers: list[dict], project: dict, query_profile: dict) -> str:
    parts = [
        f"PROJECT:\nTitle: {project['title']}\nDescription: {project['description']}\n",
        f"DOMAIN: {query_profile.get('domain', '')}\n",
        f"KEY TERMS: {', '.join(query_profile.get('technicalTerms') or [])}\n",
        "PAPERS (id · title · year · citations):",
    ]
    parts.extend(
        f"[{p['id']}] {p['title']} ({p['year']}, {p['citations']}c) — {p['abstract'][:300]}"
        for p in papers
    )
    return "\n".join(parts)


# Static snapshot of relevant FZulG paragraphs.
# Replace with a real retrieval step over an indexed legal corpus (OpenSearch / pgvector).
LEGAL_CONTEXT_SNAPSHOT = [
    {"ref": "§2 FZulG",  "summary": "Eligible R&D categories: basic research, industrial research, experimental development."},
    {"ref": "§2 Abs. 1", "summary": "R&D must be planmäßig (systematic) and aim at neue Erkenntnisse (new knowledge)."},
    {"ref": "§4 FZulG",  "summary": "Funding rate and eligible expenditure: 25% of wage costs, up to defined ceiling."},
]
