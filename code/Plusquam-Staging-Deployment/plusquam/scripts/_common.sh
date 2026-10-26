#!/usr/bin/env bash
#
# Shared helpers for plusquam deploy scripts. Sourced by:
#   - deploy.sh           (frontend → S3 + CloudFront invalidation)
#   - setup-cloudfront.sh (one-time CloudFront setup)
#   - deploy-backend.sh   (SAM build + deploy)
#
# Scripts that source this file MUST set their own `set -euo pipefail`.

# ─── Region + profile resolution ─────────────────────────────
AWS_REGION="${AWS_REGION:-eu-central-1}"

# This release is staging-only. Keep every named resource separate from prod.
STAGE="staging"
STACK_NAME="plusquam-staging"
OAC_NAME="plusquam-staging-s3-oac"
DIST_STATIC_COMMENT="plusquam staging — static (landing + sign-in)"
DIST_APP_COMMENT="plusquam staging — app SPA"

# Flag array passed to every aws CLI call. --profile only when AWS_PROFILE is set.
AWS_FLAGS=(--region "$AWS_REGION")
if [ -n "${AWS_PROFILE:-}" ]; then
  AWS_FLAGS+=(--profile "$AWS_PROFILE")
fi

# Fragment for embedding inside printed example commands.
PROFILE_FRAG="${AWS_PROFILE:+ --profile $AWS_PROFILE}"

# ─── Pretty printers ─────────────────────────────────────────
print_aws_context() {
  echo "  region:   $AWS_REGION"
  echo "  profile:  ${AWS_PROFILE:-<default>}"
  echo "  stage:    $STAGE (stack $STACK_NAME)"
}

# ─── Pre-flight: confirm AWS auth. Sets $AWS_CALLER_ACCOUNT. ──
verify_aws_auth() {
  AWS_CALLER_ACCOUNT=$(aws sts get-caller-identity "${AWS_FLAGS[@]}" --query 'Account' --output text 2>/dev/null) || {
    echo "✗ aws sts get-caller-identity failed — check your AWS credentials/profile"
    exit 1
  }
  echo "▸ Authenticated to account: $AWS_CALLER_ACCOUNT"
  if [ -z "${EXPECTED_AWS_ACCOUNT_ID:-}" ]; then
    echo "✗ Set EXPECTED_AWS_ACCOUNT_ID to the staging AWS account ID before deploying."
    exit 1
  fi
  if [[ ! "$EXPECTED_AWS_ACCOUNT_ID" =~ ^[0-9]{12}$ ]]; then
    echo "✗ EXPECTED_AWS_ACCOUNT_ID must be the 12-digit AWS account ID supplied by the client."
    exit 1
  fi
  if [ "$AWS_CALLER_ACCOUNT" != "$EXPECTED_AWS_ACCOUNT_ID" ]; then
    echo "✗ AWS account mismatch. Expected $EXPECTED_AWS_ACCOUNT_ID but authenticated to $AWS_CALLER_ACCOUNT. Aborting."
    exit 1
  fi
  echo "▸ AWS account matches the expected staging account."
}

# ─── Verify a bucket exists in the current account/region ────
verify_bucket() {
  local bucket="$1"
  local bucket_region
  if aws s3api head-bucket --bucket "$bucket" "${AWS_FLAGS[@]}" 2>/dev/null; then
    echo "  ✓ s3://$bucket"
  else
    echo "  ✗ s3://$bucket — not found in this account/region, or no permission"
    echo
    echo "    Create with:"
    echo "      aws s3 mb s3://$bucket --region $AWS_REGION$PROFILE_FRAG"
    return 1
  fi
  bucket_region=$(aws s3api get-bucket-location --bucket "$bucket" \
    --query 'LocationConstraint' --output text "${AWS_FLAGS[@]}")
  if [ "$bucket_region" = "None" ]; then bucket_region="us-east-1"; fi
  if [ "$bucket_region" != "$AWS_REGION" ]; then
    echo "✗ Bucket '$bucket' is in '$bucket_region'; this staging release requires '$AWS_REGION'."
    return 1
  fi
}

verify_staging_bucket_name() {
  local bucket="$1"
  if [[ "$bucket" != *plusquam* || "$bucket" != *staging* || "$bucket" == *prod* ]]; then
    echo "✗ Refusing bucket '$bucket'. Staging bucket names must include 'plusquam' and 'staging', and must not include 'prod'."
    return 1
  fi
}
