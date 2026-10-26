"""Admin-only handler (role == "admin" required for every route).

Routes:
  GET    /admin/users                    — list all users (no secrets)
  POST   /admin/users                    — create a user
  DELETE /admin/users/{email}            — delete a user
  POST   /admin/users/{email}/password   — reset a user's password
  GET    /admin/projects                 — list ALL users' projects
  PATCH  /admin/projects/{id}            — set reviewStatus/comment on any project
  GET    /admin/prompts                  — current pipeline prompts + defaults
  PUT    /admin/prompts                  — replace pipeline prompt overrides
"""

from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone
from urllib.parse import unquote

from lib.auth import get_claims, is_admin, hash_password
from lib.ddb import (
    list_users, get_user_by_email, put_user, delete_user,
    list_all_projects, find_project_by_id, update_project, put_prompts,
    add_notification, delete_project, delete_user_data, ProjectBusyError,
)
from lib.http import err, ok, parse_body, set_request_origin
from lib.prompts import DEFAULT_PROMPTS, PROMPT_KEYS, effective_prompts

VALID_ROLES = {"user", "admin"}
USER_REVIEW_STATES = {"none", "pq_approve", "pq_reject"}
BSFZ_REVIEW_STATES = {"bsfz_submitted", "bsfz_approved", "bsfz_rejected"}


def lambda_handler(event: dict, _context) -> dict:
    set_request_origin(event)
    claims = get_claims(event)
    if not claims:
        return err("unauthorized", 401)
    if not is_admin(claims):
        return err("forbidden: admin only", 403)

    method = event.get("requestContext", {}).get("http", {}).get("method")
    path   = event.get("requestContext", {}).get("http", {}).get("path", "")

    try:
        # ── Users ──
        if path == "/admin/users":
            if method == "GET":
                return ok([_public_user(u) for u in list_users()])
            if method == "POST":
                return _create_user(parse_body(event))

        m = re.match(r"^/admin/users/([^/]+)/password$", path)
        if m and method == "POST":
            return _reset_password(unquote(m.group(1)), parse_body(event))

        m = re.match(r"^/admin/users/([^/]+)$", path)
        if m and method == "DELETE":
            return _delete_user(unquote(m.group(1)), claims)

        # ── Projects (all users) ──
        if path == "/admin/projects" and method == "GET":
            return ok([_project_summary(p) for p in list_all_projects()])

        m = re.match(r"^/admin/projects/([^/]+)$", path)
        if m and method == "PATCH":
            return _patch_any_project(m.group(1), parse_body(event), claims)
        if m and method == "DELETE":
            item = find_project_by_id(m.group(1))
            if not item:
                return err("not found", 404)
            try:
                delete_project(item.get("userId"), m.group(1))
            except ProjectBusyError:
                return err("assessment is running; try again when it finishes", 409)
            return ok({"deleted": True})

        # ── Pipeline prompts ──
        if path == "/admin/prompts":
            if method == "GET":
                return ok({"prompts": effective_prompts(), "defaults": DEFAULT_PROMPTS})
            if method == "PUT":
                return _put_prompts(parse_body(event), claims)

        return err("not found", 404)

    except Exception as e:
        print(f"admin handler failure requestId={event.get('requestContext', {}).get('requestId', 'unknown')} type={type(e).__name__}")
        return err("internal error", 500)


# ─── users ────────────────────────────────────────────────────

def _create_user(body: dict) -> dict:
    email_value = body.get("email") or ""
    password = body.get("password") or ""
    role = body.get("role", "user")
    name = body.get("name", "")
    if not isinstance(email_value, str) or not isinstance(password, str):
        return err("email and password required")
    email = email_value.strip().lower()
    if not email or not password:
        return err("email and password required")
    if len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or len(password) < 12 or len(password) > 1024:
        return err("use a valid email and a password with at least 12 characters")
    if not isinstance(name, str) or len(name) > 120:
        return err("invalid name")
    if not isinstance(role, str) or role not in VALID_ROLES:
        return err("invalid role")
    if get_user_by_email(email):
        return err("user already exists", 409)

    pw_hash, salt, iterations = hash_password(password)
    user = {
        "userId":       "u_" + secrets.token_hex(8),
        "email":        email,
        "name":         name,
        "role":         role,
        "passwordHash": pw_hash,
        "salt":         salt,
        "iterations":   iterations,
        "authVersion":  0,
        "accountStatus": "active",
        "createdAt":    _now(),
    }
    put_user(user)
    return ok(_public_user(user), 201)


def _reset_password(email: str, body: dict) -> dict:
    email = email.strip().lower()
    password = body.get("password") or ""
    if not isinstance(password, str) or len(password) < 12 or len(password) > 1024:
        return err("password must be at least 12 characters")
    user = get_user_by_email(email)
    if not user:
        return err("user not found", 404)
    pw_hash, salt, iterations = hash_password(password)
    user.update({"passwordHash": pw_hash, "salt": salt, "iterations": iterations,
                 "authVersion": int(user.get("authVersion", 0)) + 1})
    put_user(user)
    return ok({"ok": True, "email": email})


def _delete_user(email: str, claims: dict) -> dict:
    email = email.strip().lower()
    if email == (claims.get("email") or "").lower():
        return err("you cannot delete your own account", 400)
    if not get_user_by_email(email):
        return err("user not found", 404)
    user = get_user_by_email(email)
    user.update({
        "accountStatus": "deleting",
        # Invalidate any outstanding tokens even if this record is later
        # restored manually after a partial cleanup failure.
        "authVersion": int(user.get("authVersion", 0)) + 1,
    })
    put_user(user)
    try:
        delete_user_data(user["userId"])
    except ProjectBusyError:
        return err("user has an assessment running; try again when it finishes", 409)
    delete_user(email)
    return ok({"ok": True, "email": email})


# ─── projects (admin scope) ───────────────────────────────────

def _patch_any_project(project_id: str, body: dict, claims: dict) -> dict:
    item = find_project_by_id(project_id)
    if not item:
        return err("not found", 404)
    owner = item.get("userId")
    if not owner:
        return err("project has no owner", 500)

    patch: dict = {}
    history_entry: dict | None = None
    if "reviewStatus" in body:
        rs = body["reviewStatus"]
        if not isinstance(rs, str) or rs not in USER_REVIEW_STATES | BSFZ_REVIEW_STATES:
            return err("invalid reviewStatus")
        patch["reviewStatus"] = rs
        patch["reviewStatusAt"] = _now()
        patch["reviewBy"] = claims.get("email", "admin")
        history_entry = {
            "status": rs,
            "at":     patch["reviewStatusAt"],
            "by":     patch["reviewBy"],
        }
    if "reviewComment" in body:
        patch["reviewComment"] = str(body["reviewComment"])[:5000]
    if not patch:
        return err("nothing to update")

    updated = update_project(owner, project_id, patch, history_entry)
    if not updated:
        return err("not found", 404)

    # Notify the owner of an admin-driven status change (not their own action).
    if history_entry is not None and owner != claims.get("sub"):
        add_notification(owner, {
            "id":           secrets.token_hex(6),
            "projectId":    project_id,
            "projectTitle": item.get("title", ""),
            "status":       patch["reviewStatus"],
            "by":           claims.get("email", "admin"),
            "at":           patch["reviewStatusAt"],
            "read":         False,
        })
    return ok(_project_summary(updated))


# ─── prompts (admin scope) ────────────────────────────────────

def _put_prompts(body: dict, claims: dict) -> dict:
    """Full replace of the prompt-override set. The editor submits all keys;
    a blank value or one equal to the default reverts that prompt to default
    (we persist only genuine overrides to keep the item small and let future
    default changes flow through to untouched prompts)."""
    incoming = body.get("prompts")
    if not isinstance(incoming, dict):
        return err("prompts object required")

    overrides: dict = {}
    for key in PROMPT_KEYS:
        if key not in incoming:
            continue
        val = incoming[key]
        if not isinstance(val, str):
            return err(f"prompt '{key}' must be a string")
        val = val.strip()
        if len(val) > 20_000:
            return err(f"prompt '{key}' is too long", 413)
        if val and val != DEFAULT_PROMPTS[key]:
            overrides[key] = val

    put_prompts(overrides, claims.get("email", "admin"))
    return ok({"prompts": effective_prompts(), "defaults": DEFAULT_PROMPTS})


# ─── shaping ──────────────────────────────────────────────────

def _public_user(u: dict) -> dict:
    return {
        "userId":    u.get("userId"),
        "email":     u.get("email"),
        "name":      u.get("name", ""),
        "role":      u.get("role", "user"),
        "createdAt": u.get("createdAt", ""),
    }


def _project_summary(p: dict) -> dict:
    return {
        "id":             p.get("id"),
        "userId":         p.get("userId"),
        "title":          p.get("title"),
        "domains":        p.get("domains", []),
        "status":         p.get("status"),
        "noveltyScore":   p.get("noveltyScore"),
        "reviewStatus":   p.get("reviewStatus", "none"),
        "reviewComment":  p.get("reviewComment", ""),
        "reviewStatusAt": p.get("reviewStatusAt", ""),
        "statusHistory":  p.get("statusHistory", []),
        "createdAt":      p.get("createdAt", ""),
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
