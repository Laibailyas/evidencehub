"""POST /auth/login — verify credentials against the Users table, issue a JWT.

Custom auth: PBKDF2 password check + HS256 token (see lib/auth.py).
Users are seeded via scripts/seed-admin.sh and managed in DynamoDB.
"""

from __future__ import annotations

import hashlib

from lib.auth import make_token, verify_password, get_claims
from lib.ddb import (RateLimitExceeded, check_rate_limit, consume_handoff,
                     create_handoff, get_user_by_email)
from lib.http import err, ok, parse_body, set_request_origin


def lambda_handler(event: dict, _context) -> dict:
    set_request_origin(event)
    method = event.get("requestContext", {}).get("http", {}).get("method")
    path   = event.get("requestContext", {}).get("http", {}).get("path", "")

    try:
        # GET /auth/me — return the caller's identity from their token
        if method == "GET" and path.endswith("/auth/me"):
            claims = get_claims(event)
            if not claims:
                return err("unauthorized", 401)
            return ok({"user": {
                "id": claims.get("sub"), "email": claims.get("email"),
                "role": claims.get("role", "user"), "name": claims.get("name", ""),
            }})

        # POST /auth/exchange — consume one short-lived cross-origin login code.
        if method == "POST" and path.endswith("/auth/exchange"):
            body = parse_body(event)
            handoff = consume_handoff(body.get("code", ""))
            if not handoff:
                return err("invalid or expired login code", 401)
            user = get_user_by_email(handoff["email"])
            if (not user or user.get("userId") != handoff.get("userId")
                    or int(user.get("authVersion", 0)) != int(handoff.get("authVersion", 0))
                    or user.get("accountStatus", "active") != "active"):
                return err("invalid or expired login code", 401)
            return ok({"token": make_token(user), "user": _public_user(user)})

        # POST /auth/login
        body     = parse_body(event)
        email_input = body.get("email") or ""
        password = body.get("password") or ""
        if not isinstance(email_input, str) or not isinstance(password, str):
            return err("email and password required", 400)
        email = email_input.strip().lower()
        if not email or not password:
            return err("email and password required", 400)
        if len(email) > 254 or len(password) > 1024:
            return err("invalid credentials", 401)

        # Hash identifiers before storing them so rate-limit keys contain no PII.
        ip = event.get("requestContext", {}).get("http", {}).get("sourceIp", "unknown")
        email_key = hashlib.sha256(email.encode("utf-8")).hexdigest()
        ip_key = hashlib.sha256(str(ip).encode("utf-8")).hexdigest()
        try:
            check_rate_limit(f"login-email#{email_key}", limit=10)
            check_rate_limit(f"login-ip#{ip_key}", limit=30)
        except RateLimitExceeded:
            return err("too many login attempts; try again later", 429)

        user = get_user_by_email(email)
        if not user or user.get("accountStatus", "active") != "active" or not verify_password(
            password, user.get("salt", ""), user.get("iterations", 200_000), user.get("passwordHash", "")
        ):
            return err("invalid credentials", 401)

        code = create_handoff(user["userId"], user["email"], int(user.get("authVersion", 0)))
        return ok({
            "handoffCode": code,
            "user": {
                "id":    user["userId"],
                "email": user["email"],
                "role":  user.get("role", "user"),
                "name":  user.get("name", ""),
            },
        })

    except Exception as e:
        request_id = event.get("requestContext", {}).get("requestId", "unknown")
        print(f"auth handler failure requestId={request_id} type={type(e).__name__}")
        return err("internal error", 500)


def _public_user(user: dict) -> dict:
    return {
        "id": user.get("userId"), "email": user.get("email"),
        "role": user.get("role", "user"), "name": user.get("name", ""),
    }
