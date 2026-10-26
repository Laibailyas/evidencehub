#!/usr/bin/env bash
#
# plusquam — deploy static pages + SPA to S3 and invalidate CloudFront.
#
# Usage:
#   AWS_PROFILE=client-staging \
#   EXPECTED_AWS_ACCOUNT_ID=123456789012 \
#   STATIC_BUCKET=plusquam-staging-static \
#   APP_BUCKET=plusquam-staging-app \
#   CLOUDFRONT_DIST_ID=E123ABCDEF \
#   AWS_REGION=eu-central-1 \
#   ./scripts/deploy.sh
#
# Environment variables:
#   STATIC_BUCKET        — bucket for /landing + /signin (required)
#   APP_BUCKET           — bucket for the React SPA      (required)
#   AWS_PROFILE          — named profile from ~/.aws     (optional)
#   AWS_REGION           — defaults to eu-central-1
#   CLOUDFRONT_DIST_ID   — distribution ID to invalidate (optional)
#   FRONTEND_ROOT        — path to the sibling plusquam-frontend folder (optional)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_ROOT="${FRONTEND_ROOT:-$ROOT/../plusquam-frontend}"
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
if [ ! -d "$FRONTEND_ROOT/app" ] || [ ! -d "$FRONTEND_ROOT/public" ]; then
  echo "✗ Frontend source not found at $FRONTEND_ROOT."
  echo "  Extract plusquam-frontend beside plusquam, or set FRONTEND_ROOT."
  exit 1
fi

echo "▸ plusquam frontend deploy"
print_aws_context
echo "  static bucket:  s3://$STATIC_BUCKET"
echo "  app bucket:     s3://$APP_BUCKET"
echo

verify_aws_auth
echo

# Use the deployed SAM output for both the SPA build and the static sign-in
# runtime config. This keeps signin.js free of an API endpoint baked into code.
API_BASE="${PLUSQUAM_API_BASE:-${VITE_API_BASE:-}}"
if [ -z "$API_BASE" ]; then
  API_BASE=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue | [0]" \
    --output text "${AWS_FLAGS[@]}" 2>/dev/null || true)
fi
if [ -z "$API_BASE" ] || [ "$API_BASE" = "None" ]; then
  echo "✗ Could not resolve the backend API URL. Deploy the backend first, or set PLUSQUAM_API_BASE."
  exit 1
fi
case "$API_BASE" in
  https://*) API_BASE="${API_BASE%/}" ;;
  *) echo "✗ API URL must start with https://"; exit 1 ;;
esac
echo "  API base:      $API_BASE"
echo

if [ -z "${CLOUDFRONT_DIST_ID:-}" ]; then
  CLOUDFRONT_DIST_ID=$(aws cloudfront list-distributions \
    --query "DistributionList.Items[?Comment=='$DIST_APP_COMMENT'].Id | [0]" \
    --output text "${AWS_FLAGS[@]}")
fi
if [ -z "$CLOUDFRONT_DIST_ID" ] || [ "$CLOUDFRONT_DIST_ID" = "None" ]; then
  echo "✗ Could not resolve the staging app CloudFront distribution. Run deploy-all.sh first."
  exit 1
fi
DIST_COMMENT=$(aws cloudfront get-distribution --id "$CLOUDFRONT_DIST_ID" \
  --query 'Distribution.DistributionConfig.Comment' --output text "${AWS_FLAGS[@]}")
if [ "$DIST_COMMENT" != "$DIST_APP_COMMENT" ]; then
  echo "✗ Refusing to invalidate non-staging CloudFront distribution $CLOUDFRONT_DIST_ID."
  exit 1
fi
APP_ORIGIN=$(aws cloudfront get-distribution --id "$CLOUDFRONT_DIST_ID" \
  --query 'Distribution.DistributionConfig.Origins.Items[0].DomainName' --output text "${AWS_FLAGS[@]}")
if [ "$APP_ORIGIN" != "${APP_BUCKET}.s3.${AWS_REGION}.amazonaws.com" ]; then
  echo "✗ Staging app distribution origin does not match APP_BUCKET; refusing deployment."
  exit 1
fi
APP_DOMAIN=$(aws cloudfront get-distribution --id "$CLOUDFRONT_DIST_ID" \
  --query 'Distribution.DomainName' --output text "${AWS_FLAGS[@]}")
STATIC_DIST_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='$DIST_STATIC_COMMENT'].Id | [0]" \
  --output text "${AWS_FLAGS[@]}")
if [ -z "$STATIC_DIST_ID" ] || [ "$STATIC_DIST_ID" = "None" ]; then
  echo "✗ Could not resolve the staging sign-in CloudFront distribution. Run deploy-all.sh first."
  exit 1
fi
STATIC_DOMAIN=$(aws cloudfront get-distribution --id "$STATIC_DIST_ID" \
  --query 'Distribution.DomainName' --output text "${AWS_FLAGS[@]}")
STATIC_ORIGIN=$(aws cloudfront get-distribution --id "$STATIC_DIST_ID" \
  --query 'Distribution.DistributionConfig.Origins.Items[0].DomainName' --output text "${AWS_FLAGS[@]}")
if [ "$STATIC_ORIGIN" != "${STATIC_BUCKET}.s3.${AWS_REGION}.amazonaws.com" ]; then
  echo "✗ Staging sign-in distribution origin does not match STATIC_BUCKET; refusing deployment."
  exit 1
fi
APP_URL="${PLUSQUAM_APP_URL:-https://${APP_DOMAIN}/}"
SIGNIN_URL="${PLUSQUAM_SIGNIN_URL:-https://${STATIC_DOMAIN}/}"
case "$APP_URL" in https://*) ;; *) echo "✗ PLUSQUAM_APP_URL must start with https://"; exit 1 ;; esac
case "$SIGNIN_URL" in https://*) ;; *) echo "✗ PLUSQUAM_SIGNIN_URL must start with https://"; exit 1 ;; esac
echo "  Staging sign-in: $SIGNIN_URL"
echo "  Staging app:     $APP_URL"
echo

echo "▸ Verifying buckets…"
verify_bucket "$STATIC_BUCKET"
verify_bucket "$APP_BUCKET"
echo

# ─── 1. Build SPA with this staging stack's exact URLs ───────
echo "▸ Installing locked dependencies and building SPA…"
( cd "$FRONTEND_ROOT/app" && npm ci --no-audit --no-fund && VITE_API_BASE="$API_BASE" VITE_SIGNIN_URL="$SIGNIN_URL" npm run build )
if [ ! -f "$FRONTEND_ROOT/app/dist/index.html" ]; then
  echo "✗ Frontend build did not create dist/index.html; refusing to upload."
  exit 1
fi

# ─── 2. Sync static (landing + signin) ──────────────────────
echo "▸ Syncing static pages…"
aws s3 sync "$FRONTEND_ROOT/public/" "s3://$STATIC_BUCKET/" \
  --cache-control "public, max-age=300" \
  "${AWS_FLAGS[@]}"

# Keep the sign-in page's endpoint configurable at deployment time.
runtime_config=$(mktemp)
python3 - "$API_BASE" "$APP_URL" > "$runtime_config" <<'PY'
import json
import sys

print("window.PLUSQUAM_CONFIG = Object.freeze({ apiBase: " + json.dumps(sys.argv[1]) + ", appUrl: " + json.dumps(sys.argv[2]) + " });")
PY
aws s3 cp "$runtime_config" "s3://$STATIC_BUCKET/js/runtime-config.js" \
  --cache-control "public, max-age=60" \
  --content-type "application/javascript; charset=utf-8" \
  "${AWS_FLAGS[@]}"
rm -f "$runtime_config"

# ─── 3. Sync SPA ─────────────────────────────────────────────
echo "▸ Syncing SPA build…"

# Hashed assets get long cache; HTML stays short-lived so deploys propagate.
aws s3 sync "$FRONTEND_ROOT/app/dist/" "s3://$APP_BUCKET/" \
  --exclude "index.html" \
  --cache-control "public, max-age=31536000, immutable" \
  "${AWS_FLAGS[@]}"

aws s3 cp "$FRONTEND_ROOT/app/dist/index.html" "s3://$APP_BUCKET/index.html" \
  --cache-control "public, max-age=60" \
  --content-type "text/html; charset=utf-8" \
  "${AWS_FLAGS[@]}"

# ─── 4. CloudFront invalidation ─────────────────────────────
if [ -n "${CLOUDFRONT_DIST_ID:-}" ]; then
  echo "▸ Invalidating CloudFront ($CLOUDFRONT_DIST_ID)…"
  aws cloudfront create-invalidation \
    --distribution-id "$CLOUDFRONT_DIST_ID" \
    --paths "/*" \
    "${AWS_FLAGS[@]}" \
    > /dev/null
else
  echo "▸ Skipping CloudFront invalidation (CLOUDFRONT_DIST_ID not set)"
  echo
  echo "  If you haven't created distributions yet, run:"
  echo "    ./scripts/setup-cloudfront.sh"
fi

echo
echo "✓ Deploy complete (account $AWS_CALLER_ACCOUNT, region $AWS_REGION)."
