"""Project CRUD + per-user state handler.

Routes:
  GET    /projects        — list current user's projects
  POST   /projects        — create new project
  GET    /projects/{id}   — fetch one
  PATCH  /projects/{id}   — update reviewStatus / reviewComment (BSFZ = admin only)
  GET    /me/stars        — current user's starred projects + papers
  PUT    /me/stars        — replace the user's starred set
"""

from __future__ import annotations

import base64
import binascii
import re
import secrets
import json
from datetime import datetime, timezone

from lib.auth import get_claims, is_admin
from lib.ddb import (
    get_project, list_projects, put_project, update_project,
    get_user_state, put_user_state,
    get_notifications, mark_notifications_read,
    delete_project, ProjectBusyError,
)
from lib.extract import extract_text
from lib.http import err, ok, parse_body, set_request_origin

SOURCE_TEXT_CAP = 20_000  # chars persisted from an uploaded doc
MAX_UPLOAD_BYTES = 4 * 1024 * 1024
MAX_STARS_PER_KIND = 100

USER_REVIEW_STATES = {"none", "pq_approve", "pq_reject"}
BSFZ_REVIEW_STATES = {"bsfz_submitted", "bsfz_approved", "bsfz_rejected"}


def lambda_handler(event: dict, _context) -> dict:
    set_request_origin(event)
    claims = get_claims(event)
    if not claims:
        return err("unauthorized", 401)
    user_id = claims["sub"]
    method  = event.get("requestContext", {}).get("http", {}).get("method")
    path    = event.get("requestContext", {}).get("http", {}).get("path", "")

    try:
        if method == "GET" and path == "/projects":
            return ok(list_projects(user_id))

        if method == "POST" and path == "/projects":
            body = parse_body(event)
            title = body.get("title")
            description = body.get("description", "")
            domains = body.get("domains", [])
            reference = body.get("reference", "")
            if not isinstance(title, str) or not title.strip():
                return err("title required")
            if len(title) > 300 or not isinstance(description, str) or len(description) > 10_000:
                return err("project text is too long", 413)
            if not isinstance(domains, list) or len(domains) > 15 or any(
                not isinstance(item, str) or len(item) > 80 for item in domains
            ):
                return err("invalid domains", 400)
            if not isinstance(reference, str) or len(reference) > 2_000:
                return err("invalid reference", 400)
            project = {
                "id":          "p" + secrets.token_hex(12),
                "userId":      user_id,
                "title":       title.strip(),
                "description": description,
                "domains":     domains,
                "reference":   reference,
                "status":      "pending",
                "reviewStatus": "none",
                "reviewComment": "",
                "statusHistory": [],
                "createdAt":   _now(),
            }

            # Optional upload is validated server-side; malformed files fail closed.
            _attach_source(project, body.get("upload"))

            put_project(project)
            # Don't echo the (potentially large) extracted text back to the client.
            return ok({k: v for k, v in project.items() if k != "sourceText"}, 201)

        # Per-user starred set
        if path == "/me/stars":
            if method == "GET":
                state = get_user_state(user_id)
                return ok({
                    "projects": state.get("projects", []),
                    "papers":   state.get("papers", []),
                })
            if method == "PUT":
                body = parse_body(event)
                state = {
                    "projects": body.get("projects", []),
                    "papers":   body.get("papers", []),
                }
                if not _valid_star_list(state["projects"]) or not _valid_star_list(state["papers"]):
                    return err("invalid starred items", 400)
                if len(json.dumps(state, ensure_ascii=False).encode("utf-8")) > 250_000:
                    return err("starred items are too large", 413)
                put_user_state(user_id, state)
                return ok(state)

        # Notifications (admin status changes land here)
        if path == "/me/notifications" and method == "GET":
            items = get_notifications(user_id)
            return ok({"items": items, "unread": sum(1 for i in items if not i.get("read"))})
        if path == "/me/notifications/read" and method == "POST":
            mark_notifications_read(user_id)
            return ok({"ok": True})

        m = re.match(r"^/projects/([^/]+)$", path)
        if m:
            project_id = m.group(1)
            if method == "GET":
                p = get_project(user_id, project_id)
                return ok(p) if p else err("not found", 404)

            if method == "DELETE":
                try:
                    deleted = delete_project(user_id, project_id)
                except ProjectBusyError:
                    return err("assessment is running; try again when it finishes", 409)
                return ok({"deleted": True}) if deleted else err("not found", 404)

            if method == "PATCH":
                body = parse_body(event)
                patch: dict = {}
                history_entry: dict | None = None

                if "reviewStatus" in body:
                    rs = body["reviewStatus"]
                    if not isinstance(rs, str):
                        return err("invalid reviewStatus")
                    if rs in BSFZ_REVIEW_STATES and not is_admin(claims):
                        return err("forbidden: BSFZ status requires admin", 403)
                    if rs not in USER_REVIEW_STATES | BSFZ_REVIEW_STATES:
                        return err("invalid reviewStatus")
                    patch["reviewStatus"] = rs
                    patch["reviewStatusAt"] = _now()
                    patch["reviewBy"] = claims.get("email", user_id)
                    history_entry = {
                        "status": rs,
                        "at":     patch["reviewStatusAt"],
                        "by":     patch["reviewBy"],
                    }

                if "reviewComment" in body:
                    patch["reviewComment"] = str(body["reviewComment"])[:5000]

                if not patch:
                    return err("nothing to update")

                updated = update_project(user_id, project_id, patch, history_entry)
                return ok(updated) if updated else err("not found", 404)

        return err("not found", 404)

    except UploadValidationError as e:
        return err(str(e), e.status)
    except Exception as e:
        print(f"projects handler failure requestId={event.get('requestContext', {}).get('requestId', 'unknown')} type={type(e).__name__}")
        return err("internal error", 500)


# ─── helpers ──────────────────────────────────────────────────


class UploadValidationError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _attach_source(project: dict, upload) -> None:
    """Validate and extract a bounded PDF or DOCX upload."""
    if upload is None:
        return
    if not isinstance(upload, dict):
        raise UploadValidationError("invalid upload")
    encoded = upload.get("dataBase64")
    filename = upload.get("filename")
    content_type = upload.get("contentType", "")
    if not all(isinstance(v, str) for v in (encoded, filename, content_type)):
        raise UploadValidationError("invalid upload")
    if len(encoded) > ((MAX_UPLOAD_BYTES + 2) // 3) * 4 + 8:
        raise UploadValidationError("file too large (maximum 4 MB)", 413)
    try:
        data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise UploadValidationError("invalid file encoding") from None
    if not data or len(data) > MAX_UPLOAD_BYTES:
        raise UploadValidationError("file too large or empty", 413)
    safe_name = filename.replace("\\", "/").rsplit("/", 1)[-1].strip()
    ext = safe_name.lower().rsplit(".", 1)[-1] if "." in safe_name else ""
    ctype = content_type.lower().split(";", 1)[0].strip()
    if ext == "pdf":
        if ctype not in ("", "application/pdf", "application/octet-stream") or not data.startswith(b"%PDF-"):
            raise UploadValidationError("file must be a valid PDF")
    elif ext == "docx":
        if ctype not in ("", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/octet-stream"):
            raise UploadValidationError("file must be a valid DOCX document")
        if not data.startswith(b"PK\x03\x04"):
            raise UploadValidationError("file must be a valid DOCX document")
    else:
        raise UploadValidationError("only PDF and DOCX files are supported")
    try:
        text = (extract_text(safe_name, ctype, data) or "").strip()
    except Exception:
        raise UploadValidationError("could not read uploaded document") from None
    if not text:
        raise UploadValidationError("could not extract text from uploaded document")
    project["sourceText"] = text[:SOURCE_TEXT_CAP]
    project["sourceName"] = safe_name[:200]
    project["sourceChars"] = len(text)


def _valid_star_list(value) -> bool:
    return isinstance(value, list) and len(value) <= MAX_STARS_PER_KIND and all(
        isinstance(item, (str, dict)) and len(json.dumps(item, ensure_ascii=False)) <= 2_000
        for item in value
    )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


