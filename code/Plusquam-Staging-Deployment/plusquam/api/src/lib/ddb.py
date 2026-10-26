"""DynamoDB access patterns for Projects + Assessments tables.

Schema:
  Projects table        — pk = USER#<userId>      sk = PROJECT#<projectId>
  Assessments table:    — pk = PROJECT#<projectId>
                          sk = STEP#01..STEP#07   (per-step status)
                          sk = ASSESSMENT         (final compiled output)
"""

from __future__ import annotations

import json
import hashlib
import os
import time
from secrets import token_urlsafe
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import boto3
from boto3.dynamodb.conditions import Attr, Key

_dynamodb = boto3.resource("dynamodb")
_projects_table     = _dynamodb.Table(os.environ["PROJECTS_TABLE"])
_assessments_table  = _dynamodb.Table(os.environ["ASSESSMENTS_TABLE"])
_users_table        = _dynamodb.Table(os.environ["USERS_TABLE"])
_rate_limits_table   = _dynamodb.Table(os.environ["RATE_LIMITS_TABLE"])
_handoffs_table      = _dynamodb.Table(os.environ["HANDOFFS_TABLE"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _to_dynamo(value: Any) -> Any:
    """Recursively convert floats to Decimal — DynamoDB rejects Python floats.

    Round-tripping through json keeps it simple and also drops any NaN/Infinity
    that would otherwise break Decimal. parse_float=Decimal does the conversion.

    Values read back from DynamoDB already contain Decimal (e.g. noveltyScore),
    which json.dumps can't serialise — so we coerce those to int/float on the way
    out, and parse_float=Decimal turns the fractional ones back into Decimal.
    """
    def _default(o: Any) -> Any:
        if isinstance(o, Decimal):
            return int(o) if o % 1 == 0 else float(o)
        raise TypeError(f"not JSON serialisable: {type(o).__name__}")

    return json.loads(json.dumps(value, default=_default), parse_float=Decimal)


# ─── Projects ──────────────────────────────────────────────────

def put_project(project: dict) -> None:
    _projects_table.put_item(Item=_to_dynamo({
        "pk": f"USER#{project['userId']}",
        "sk": f"PROJECT#{project['id']}",
        **project,
    }))


def get_project(user_id: str, project_id: str) -> dict | None:
    r = _projects_table.get_item(Key={
        "pk": f"USER#{user_id}",
        "sk": f"PROJECT#{project_id}",
    })
    return r.get("Item")


def delete_project(user_id: str, project_id: str) -> bool:
    """Delete a project and its assessment artifacts. Owner-scoped: returns
    False if the project doesn't belong to user_id."""
    if not get_project(user_id, project_id):
        return False
    lock = _assessments_table.get_item(
        Key={"pk": f"PROJECT#{project_id}", "sk": "RUN_LOCK"}, ConsistentRead=True
    ).get("Item")
    if lock and int(lock.get("expiresAt", 0)) > int(time.time()):
        raise ProjectBusyError()
    # Delete dependent assessment records first so failures never leave an
    # unowned assessment exposed after its project record disappears.
    kwargs = {"KeyConditionExpression": Key("pk").eq(f"PROJECT#{project_id}")}
    with _assessments_table.batch_writer() as bw:
        while True:
            r = _assessments_table.query(**kwargs)
            for it in r.get("Items", []):
                bw.delete_item(Key={"pk": it["pk"], "sk": it["sk"]})
            if "LastEvaluatedKey" not in r:
                break
            kwargs["ExclusiveStartKey"] = r["LastEvaluatedKey"]
    _projects_table.delete_item(Key={"pk": f"USER#{user_id}", "sk": f"PROJECT#{project_id}"})
    return True


def list_projects(user_id: str) -> list[dict]:
    items: list[dict] = []
    kwargs = {"KeyConditionExpression": Key("pk").eq(f"USER#{user_id}") & Key("sk").begins_with("PROJECT#")}
    while True:
        r = _projects_table.query(**kwargs)
        items.extend(r.get("Items", []))
        if "LastEvaluatedKey" not in r:
            return items
        kwargs["ExclusiveStartKey"] = r["LastEvaluatedKey"]


def update_project(
    user_id: str,
    project_id: str,
    patch: dict,
    history_entry: dict | None = None,
) -> dict | None:
    """Merge `patch` into an existing project record and persist. Returns the
    updated item, or None if the project doesn't exist for this user.

    If `history_entry` is given (e.g. {"status", "at", "by"}), it is appended to
    the record's `statusHistory` list (capped) so KPIs can be derived from real
    transition timestamps.
    """
    existing = get_project(user_id, project_id)
    if not existing:
        return None
    if history_entry is not None:
        hist = existing.get("statusHistory") or []
        hist.append(history_entry)
        existing["statusHistory"] = hist[-100:]  # cap to keep the item small
    existing.update(patch)
    _projects_table.put_item(Item=_to_dynamo(existing))
    return existing


# ─── Admin scope (all users' projects) ─────────────────────────

def list_all_projects() -> list[dict]:
    items: list[dict] = []
    kwargs = {"FilterExpression": Attr("sk").begins_with("PROJECT#")}
    resp = _projects_table.scan(**kwargs)
    items.extend(resp.get("Items", []))
    while "LastEvaluatedKey" in resp:
        resp = _projects_table.scan(ExclusiveStartKey=resp["LastEvaluatedKey"], **kwargs)
        items.extend(resp.get("Items", []))
    return items


def find_project_by_id(project_id: str) -> dict | None:
    resp = _projects_table.scan(FilterExpression=Attr("sk").eq(f"PROJECT#{project_id}"))
    items = resp.get("Items", [])
    return items[0] if items else None


# ─── App config: editable pipeline prompts ─────────────────────
# Stored as a single item on the projects table (pk=CONFIG, sk=PROMPTS).
# Both AdminFunction and AssessFunction already have CRUD on this table.

def get_prompts() -> dict:
    r = _projects_table.get_item(Key={"pk": "CONFIG", "sk": "PROMPTS"})
    item = r.get("Item")
    return item.get("prompts", {}) if item else {}


def put_prompts(prompts: dict, updated_by: str = "") -> None:
    _projects_table.put_item(Item=_to_dynamo({
        "pk": "CONFIG", "sk": "PROMPTS",
        "prompts": prompts,
        "updatedAt": _now(),
        "updatedBy": updated_by,
    }))


# ─── Per-user state (starred projects + papers) ────────────────

def get_user_state(user_id: str) -> dict:
    r = _projects_table.get_item(Key={"pk": f"USER#{user_id}", "sk": "STATE"})
    item = r.get("Item")
    return item.get("state", {}) if item else {}


def put_user_state(user_id: str, state: dict) -> None:
    _projects_table.put_item(Item=_to_dynamo({
        "pk": f"USER#{user_id}", "sk": "STATE", "state": state,
    }))


# ─── Notifications (per user; admin status changes) ───────────
# Stored as a single capped list on the projects table (pk=USER#<id>, sk=NOTIFS).

def get_notifications(user_id: str) -> list[dict]:
    r = _projects_table.get_item(Key={"pk": f"USER#{user_id}", "sk": "NOTIFS"})
    item = r.get("Item")
    return item.get("items", []) if item else []


def put_notifications(user_id: str, items: list[dict]) -> None:
    _projects_table.put_item(Item=_to_dynamo({
        "pk": f"USER#{user_id}", "sk": "NOTIFS", "items": items,
    }))


def add_notification(user_id: str, notif: dict, cap: int = 50) -> None:
    items = get_notifications(user_id)
    items.insert(0, notif)  # newest first
    put_notifications(user_id, items[:cap])


def mark_notifications_read(user_id: str) -> None:
    items = get_notifications(user_id)
    changed = False
    for it in items:
        if not it.get("read"):
            it["read"] = True
            changed = True
    if changed:
        put_notifications(user_id, items)


# ─── Assessments + per-step status ─────────────────────────────

def update_step_status(project_id: str, step_index: int, status: str, payload: Any = None) -> None:
    _assessments_table.put_item(Item=_to_dynamo({
        "pk":        f"PROJECT#{project_id}",
        "sk":        f"STEP#{step_index:02d}",
        "status":    status,
        "payload":   payload,
        "updatedAt": _now(),
    }))


def put_assessment(project_id: str, assessment: dict) -> None:
    _assessments_table.put_item(Item=_to_dynamo({
        "pk":          f"PROJECT#{project_id}",
        "sk":          "ASSESSMENT",
        "assessment":  assessment,
        "completedAt": _now(),
    }))


def get_assessment(project_id: str) -> dict | None:
    r = _assessments_table.get_item(Key={
        "pk": f"PROJECT#{project_id}",
        "sk": "ASSESSMENT",
    })
    item = r.get("Item")
    return item.get("assessment") if item else None


def get_status(project_id: str) -> list[dict]:
    r = _assessments_table.query(
        KeyConditionExpression=Key("pk").eq(f"PROJECT#{project_id}") & Key("sk").begins_with("STEP#")
    )
    return r.get("Items", [])


# ─── users ────────────────────────────────────────────────────

def get_user_by_email(email: str) -> dict | None:
    r = _users_table.get_item(Key={"pk": f"EMAIL#{email.lower()}"})
    return r.get("Item")


def put_user(user: dict) -> None:
    """user must include email, userId, role, passwordHash, salt, iterations."""
    item = {"pk": f"EMAIL#{user['email'].lower()}", **user}
    _users_table.put_item(Item=_to_dynamo(item))


def list_users() -> list[dict]:
    return _users_table.scan().get("Items", [])


def delete_user(email: str) -> None:
    _users_table.delete_item(Key={"pk": f"EMAIL#{email.lower()}"})


def delete_user_data(user_id: str) -> None:
    """Delete a user's projects, assessment artifacts, and per-user state."""
    projects = list_projects(user_id)
    for project in projects:
        delete_project(user_id, project["id"])
    kwargs = {"KeyConditionExpression": Key("pk").eq(f"USER#{user_id}")}
    with _projects_table.batch_writer() as bw:
        while True:
            response = _projects_table.query(**kwargs)
            for item in response.get("Items", []):
                bw.delete_item(Key={"pk": item["pk"], "sk": item["sk"]})
            if "LastEvaluatedKey" not in response:
                break
            kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]


class RateLimitExceeded(Exception):
    pass


class ProjectBusyError(Exception):
    pass


def check_rate_limit(key: str, limit: int, window_seconds: int = 900) -> None:
    """Atomically count requests within a fixed window. Keys should be hashed."""
    bucket = int(time.time()) // window_seconds
    expires = (bucket + 2) * window_seconds
    try:
        _rate_limits_table.update_item(
            Key={"pk": f"{key}#{bucket}"},
            UpdateExpression="SET expiresAt = :expires ADD requestCount :one",
            ConditionExpression="attribute_not_exists(requestCount) OR requestCount < :limit",
            ExpressionAttributeValues={
                ":expires": expires, ":one": 1, ":limit": limit,
            },
        )
    except Exception as exc:
        if getattr(exc, "response", {}).get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            raise RateLimitExceeded() from None
        raise


def create_handoff(user_id: str, email: str, auth_version: int = 0, ttl_seconds: int = 60) -> str:
    """Create a short-lived, single-use opaque login handoff code."""
    code = token_urlsafe(32)
    digest = hashlib.sha256(code.encode("ascii")).hexdigest()
    _handoffs_table.put_item(
        Item={"codeHash": digest, "userId": user_id, "email": email.lower(),
              "authVersion": int(auth_version),
              "expiresAt": int(time.time()) + ttl_seconds},
        ConditionExpression="attribute_not_exists(codeHash)",
    )
    return code


def consume_handoff(code: str) -> dict | None:
    if not isinstance(code, str) or len(code) > 128:
        return None
    digest = hashlib.sha256(code.encode("ascii", "ignore")).hexdigest()
    item = _handoffs_table.get_item(Key={"codeHash": digest}, ConsistentRead=True).get("Item")
    if not item:
        return None
    try:
        _handoffs_table.delete_item(
            Key={"codeHash": digest},
            ConditionExpression="expiresAt > :now",
            ExpressionAttributeValues={":now": int(time.time())},
        )
    except Exception as exc:
        if getattr(exc, "response", {}).get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return None
        raise
    return item


def acquire_assessment_lock(project_id: str, lease_id: str, lease_seconds: int = 900) -> bool:
    now = int(time.time())
    try:
        _assessments_table.put_item(
            Item={"pk": f"PROJECT#{project_id}", "sk": "RUN_LOCK",
                  "leaseId": lease_id, "expiresAt": now + lease_seconds},
            ConditionExpression="attribute_not_exists(pk) OR expiresAt < :now",
            ExpressionAttributeValues={":now": now},
        )
        return True
    except Exception as exc:
        if getattr(exc, "response", {}).get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return False
        raise


def release_assessment_lock(project_id: str, lease_id: str) -> None:
    _assessments_table.delete_item(
        Key={"pk": f"PROJECT#{project_id}", "sk": "RUN_LOCK"},
        ConditionExpression="leaseId = :lease",
        ExpressionAttributeValues={":lease": lease_id},
    )
