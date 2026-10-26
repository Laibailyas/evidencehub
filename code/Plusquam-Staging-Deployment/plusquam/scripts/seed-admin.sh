#!/usr/bin/env bash
# Create a first user directly in the isolated Plusquam staging users table.
# Staging-only release: this script cannot target prod.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=_common.sh
source "$ROOT/scripts/_common.sh"

EMAIL="${1:-}"
ROLE="${2:-admin}"
NAME="${3:-Staging Admin}"
TABLE="plusquam-staging-users"

if [ -z "$EMAIL" ]; then
  echo "Usage: EXPECTED_AWS_ACCOUNT_ID=<staging-account-id> $0 <email> [admin|user] [name]" >&2
  exit 1
fi
if [[ ! "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  echo "error: provide a valid email address" >&2
  exit 1
fi
if [[ "$ROLE" != "admin" && "$ROLE" != "user" ]]; then
  echo "error: role must be admin or user" >&2
  exit 1
fi

command -v aws >/dev/null 2>&1 || { echo "error: AWS CLI not found on PATH" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "error: Python 3 not found on PATH" >&2; exit 1; }

print_aws_context
verify_aws_auth
echo "  target table: $TABLE"

read -r -s -p "Set a staging password (12-1024 characters): " PASSWORD
echo
if [ "${#PASSWORD}" -lt 12 ] || [ "${#PASSWORD}" -gt 1024 ]; then
  echo "error: password must be between 12 and 1024 characters" >&2
  exit 1
fi

TMP="$(mktemp)"
PASSWORD_FILE="$(mktemp)"
chmod 600 "$PASSWORD_FILE"
trap 'rm -f "$TMP" "$PASSWORD_FILE"' EXIT
printf '%s' "$PASSWORD" > "$PASSWORD_FILE"
PASSWORD=""

python3 - "$EMAIL" "$ROLE" "$NAME" "$PASSWORD_FILE" > "$TMP" <<'PY'
import sys, json, time, secrets, hashlib
email, role, name, password_path = sys.argv[1:5]
with open(password_path, "r", encoding="utf-8") as handle:
    password = handle.read()
iterations = 200_000
salt = secrets.token_hex(16)
pw_hash = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), iterations).hex()
print(json.dumps({
    "pk":           {"S": f"EMAIL#{email.lower()}"},
    "userId":       {"S": "u_" + secrets.token_hex(8)},
    "email":        {"S": email},
    "name":         {"S": name},
    "role":         {"S": role},
    "passwordHash": {"S": pw_hash},
    "salt":         {"S": salt},
    "iterations":   {"N": str(iterations)},
    "authVersion":  {"N": "0"},
    "createdAt":    {"S": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
}))
PY

rm -f "$PASSWORD_FILE"
aws dynamodb put-item --table-name "$TABLE" --item "file://$TMP" \
  --condition-expression 'attribute_not_exists(pk)' "${AWS_FLAGS[@]}"
echo "✓ created ${ROLE} staging user: ${EMAIL} (table ${TABLE}, ${AWS_REGION})"
