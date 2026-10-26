#!/usr/bin/env bash
#
# plusquam — deploy everything in order.
#
# Runs:
#   1. setup-cloudfront.sh   (idempotent — skips resources that already exist)
#   2. deploy-backend.sh     (interactive on first run; non-interactive after)
#   3. deploy.sh             (frontend build + sync + invalidation)
#
# Looks up the app distribution ID after step 1 and passes it to step 3,
# so you don't have to copy/paste it between commands.
#
# Usage:
#   AWS_PROFILE=client-staging \
#   EXPECTED_AWS_ACCOUNT_ID=123456789012 \
#   STATIC_BUCKET=plusquam-staging-static \
#   APP_BUCKET=plusquam-staging-app \
#   AWS_REGION=eu-central-1 \
#   ./scripts/deploy-all.sh
#
# Notes:
#   * The backend is pinned to the plusquam-staging stack and Stage=staging.
#   * A provider API key is stored in a staging-specific Secrets Manager secret.
#   * CloudFront distributions and S3 buckets must be staging-only.
#   * For ongoing frontend-only changes, use `./scripts/deploy.sh` directly —
#     it skips the CloudFront and backend steps.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=_common.sh
source "$ROOT/scripts/_common.sh"

: "${STATIC_BUCKET:?STATIC_BUCKET is required}"
: "${APP_BUCKET:?APP_BUCKET is required}"
verify_staging_bucket_name "$STATIC_BUCKET"
verify_staging_bucket_name "$APP_BUCKET"
if [ "$STATIC_BUCKET" = "$APP_BUCKET" ]; then
  echo "✗ STATIC_BUCKET and APP_BUCKET must be different staging buckets."
  exit 1
fi

echo "▸ plusquam — full deploy (3 steps)"
print_aws_context
echo "  static bucket:  s3://$STATIC_BUCKET"
echo "  app bucket:     s3://$APP_BUCKET"
echo

verify_aws_auth
echo

# ─── Step 1: CloudFront ─────────────────────────────────────
echo "═════════════════════════════════════════════════════════════"
echo " Step 1/3 — CloudFront distributions"
echo "═════════════════════════════════════════════════════════════"
"$ROOT/scripts/setup-cloudfront.sh"

# Look up the two staging distributions that step 1 just created (or found).
echo
echo "▸ Resolving staging distribution IDs…"
STATIC_DIST_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='$DIST_STATIC_COMMENT'].Id | [0]" \
  --output text \
  "${AWS_FLAGS[@]}" 2>/dev/null || echo "None")
APP_DIST_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='$DIST_APP_COMMENT'].Id | [0]" \
  --output text \
  "${AWS_FLAGS[@]}" 2>/dev/null || echo "None")

if [ "$STATIC_DIST_ID" = "None" ] || [ -z "$STATIC_DIST_ID" ] || [ "$APP_DIST_ID" = "None" ] || [ -z "$APP_DIST_ID" ]; then
  echo "✗ Could not resolve both staging distribution IDs after setup. Aborting."
  exit 1
fi
STATIC_DOMAIN=$(aws cloudfront get-distribution --id "$STATIC_DIST_ID" \
  --query 'Distribution.DomainName' --output text "${AWS_FLAGS[@]}")
APP_DOMAIN=$(aws cloudfront get-distribution --id "$APP_DIST_ID" \
  --query 'Distribution.DomainName' --output text "${AWS_FLAGS[@]}")
export CORS_ALLOWED_ORIGINS="https://${STATIC_DOMAIN},https://${APP_DOMAIN}"
export PLUSQUAM_SIGNIN_URL="https://${STATIC_DOMAIN}/"
export PLUSQUAM_APP_URL="https://${APP_DOMAIN}/"
echo "  ✓ Static: https://${STATIC_DOMAIN} ($STATIC_DIST_ID)"
echo "  ✓ App:    https://${APP_DOMAIN} ($APP_DIST_ID)"
echo "  ✓ CORS origins: $CORS_ALLOWED_ORIGINS"

# ─── Step 2: Backend ────────────────────────────────────────
echo
echo "═════════════════════════════════════════════════════════════"
echo " Step 2/3 — Backend (Lambda + DynamoDB + API Gateway)"
echo "═════════════════════════════════════════════════════════════"
"$ROOT/scripts/deploy-backend.sh"

# ─── Step 3: Frontend ───────────────────────────────────────
echo
echo "═════════════════════════════════════════════════════════════"
echo " Step 3/3 — Frontend (build SPA + sync S3 + invalidate)"
echo "═════════════════════════════════════════════════════════════"
CLOUDFRONT_DIST_ID="$APP_DIST_ID" "$ROOT/scripts/deploy.sh"

# ─── Summary ────────────────────────────────────────────────
echo
echo "═════════════════════════════════════════════════════════════"
echo " ✓ Full deploy complete"
echo "═════════════════════════════════════════════════════════════"

STATIC_STATUS=$(aws cloudfront get-distribution --id "$STATIC_DIST_ID" \
  --query 'Distribution.Status' --output text "${AWS_FLAGS[@]}")
APP_STATUS=$(aws cloudfront get-distribution --id "$APP_DIST_ID" \
  --query 'Distribution.Status' --output text "${AWS_FLAGS[@]}")

cat <<SUMMARY

  Static:  https://${STATIC_DOMAIN}     [$STATIC_STATUS]
  App:     https://${APP_DOMAIN}        [$APP_STATUS]

If status is "InProgress", give CloudFront 5–15 min to propagate globally.
Re-check:
  aws cloudfront get-distribution --id $APP_DIST_ID --query 'Distribution.Status' --output text$PROFILE_FRAG

For ongoing frontend-only changes, just run:
  AWS_PROFILE=${AWS_PROFILE:-<default>} \\
  STATIC_BUCKET=$STATIC_BUCKET \\
  APP_BUCKET=$APP_BUCKET \\
  CLOUDFRONT_DIST_ID=$APP_DIST_ID \\
  ./scripts/deploy.sh
SUMMARY
