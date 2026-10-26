#!/usr/bin/env bash
#
# plusquam — one-time CloudFront setup.
#
# Creates two CloudFront distributions in front of the S3 buckets, plus the bucket
# policies that grant CloudFront read access via Origin Access Control (OAC).
#
# Re-runnable: detects existing OAC + distributions by name/comment and skips
# creation if they're already there.
#
# Usage:
#   AWS_PROFILE=client-staging \
#   EXPECTED_AWS_ACCOUNT_ID=123456789012 \
#   STATIC_BUCKET=plusquam-staging-static \
#   APP_BUCKET=plusquam-staging-app \
#   AWS_REGION=eu-central-1 \
#   ./scripts/setup-cloudfront.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=_common.sh
source "$ROOT/scripts/_common.sh"

: "${STATIC_BUCKET:?STATIC_BUCKET is required}"
: "${APP_BUCKET:?APP_BUCKET is required}"

# OAC_NAME, DIST_STATIC_COMMENT, DIST_APP_COMMENT come from _common.sh
# so deploy-all.sh can look up the resources we create here.

# AWS-managed cache policy "CachingOptimized" — sensible defaults for static assets.
MANAGED_CACHE_POLICY_ID="658327ea-f89d-4fab-a63d-7e88639e58f6"
SECURITY_POLICY_NAME="plusquam-staging-security-headers"

echo "▸ plusquam CloudFront setup"
print_aws_context
echo "  static bucket:  s3://$STATIC_BUCKET"
echo "  app bucket:     s3://$APP_BUCKET"
echo

verify_staging_bucket_name "$STATIC_BUCKET"
verify_staging_bucket_name "$APP_BUCKET"
if [ "$STATIC_BUCKET" = "$APP_BUCKET" ]; then
  echo "✗ STATIC_BUCKET and APP_BUCKET must be different staging buckets."
  exit 1
fi

verify_aws_auth
echo

command -v python3 >/dev/null 2>&1 || {
  echo "✗ python3 is required to update CloudFront distribution configuration."
  exit 1
}

echo "▸ Verifying staging buckets…"
verify_bucket "$STATIC_BUCKET"
verify_bucket "$APP_BUCKET"
echo

echo "▸ CloudFront security response headers…"
SECURITY_HEADERS_POLICY_ID=$(aws cloudfront list-response-headers-policies \
  --type custom \
  --query "ResponseHeadersPolicyList.Items[?ResponseHeadersPolicy.ResponseHeadersPolicyConfig.Name=='$SECURITY_POLICY_NAME'].ResponseHeadersPolicy.Id | [0]" \
  --output text \
  "${AWS_FLAGS[@]}" 2>/dev/null || echo "None")

if [ "$SECURITY_HEADERS_POLICY_ID" = "None" ] || [ -z "$SECURITY_HEADERS_POLICY_ID" ]; then
  policy_config_file=$(mktemp)
  python3 - "$AWS_REGION" "$SECURITY_POLICY_NAME" > "$policy_config_file" <<'PY'
import json
import sys

region, policy_name = sys.argv[1:3]
config = {
    "Name": policy_name,
    "Comment": "Staging security headers for plusquam staging origins",
    "SecurityHeadersConfig": {
        "ContentSecurityPolicy": {
            "ContentSecurityPolicy": (
                "default-src 'self'; script-src 'self'; "
                f"connect-src 'self' https://*.execute-api.{region}.amazonaws.com; "
                "img-src 'self' data:; "
                "style-src 'self' https://fonts.googleapis.com; "
                "font-src 'self' https://fonts.gstatic.com data:; "
                "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; "
                "form-action 'self'; upgrade-insecure-requests"
            ),
            "Override": True,
        },
        "FrameOptions": {"FrameOption": "DENY", "Override": True},
        "ContentTypeOptions": {"Override": True},
        "ReferrerPolicy": {
            "ReferrerPolicy": "strict-origin-when-cross-origin",
            "Override": True,
        },
        "StrictTransportSecurity": {
            "AccessControlMaxAgeSec": 31536000,
            "IncludeSubdomains": False,
            "Preload": False,
            "Override": True,
        },
    },
    "CustomHeadersConfig": {
        "Quantity": 4,
        "Items": [{
            "Header": "Permissions-Policy",
            "Value": "camera=(), geolocation=(), microphone=()",
            "Override": True,
        }, {"Header": "Cross-Origin-Opener-Policy", "Value": "same-origin", "Override": True},
           {"Header": "Cross-Origin-Embedder-Policy", "Value": "require-corp", "Override": True},
           {"Header": "Cross-Origin-Resource-Policy", "Value": "same-origin", "Override": True}],
    },
    "RemoveHeadersConfig": {"Quantity": 1, "Items": [{"Header": "Server"}]},
    "ServerTimingHeadersConfig": {"Enabled": False, "SamplingRate": 0},
}
json.dump(config, sys.stdout)
PY
  SECURITY_HEADERS_POLICY_ID=$(aws cloudfront create-response-headers-policy \
    --response-headers-policy-config "file://$policy_config_file" \
    --query 'ResponseHeadersPolicy.Id' \
    --output text \
    "${AWS_FLAGS[@]}")
  rm -f "$policy_config_file"
  echo "  ✓ Created response headers policy: $SECURITY_HEADERS_POLICY_ID"
else
  echo "  ✓ Response headers policy exists: $SECURITY_HEADERS_POLICY_ID"
fi
echo

echo "▸ Enabling S3 Block Public Access (CloudFront OAC remains the reader)…"
for bucket in "$STATIC_BUCKET" "$APP_BUCKET"; do
  aws s3api put-public-access-block \
    --bucket "$bucket" \
    --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true \
    "${AWS_FLAGS[@]}"
  echo "  ✓ Public S3 access blocked: s3://$bucket"
done
echo

# ─── 1. Origin Access Control ────────────────────────────────
echo "▸ Origin Access Control…"
OAC_ID=$(aws cloudfront list-origin-access-controls \
  --query "OriginAccessControlList.Items[?Name=='$OAC_NAME'].Id | [0]" \
  --output text \
  "${AWS_FLAGS[@]}" 2>/dev/null || echo "None")

if [ "$OAC_ID" != "None" ] && [ -n "$OAC_ID" ]; then
  echo "  ✓ OAC already exists: $OAC_ID"
else
  OAC_ID=$(aws cloudfront create-origin-access-control \
    --origin-access-control-config "{
      \"Name\": \"$OAC_NAME\",
      \"Description\": \"plusquam S3 OAC — signs CloudFront → S3 requests with SigV4\",
      \"SigningProtocol\": \"sigv4\",
      \"SigningBehavior\": \"always\",
      \"OriginAccessControlOriginType\": \"s3\"
    }" \
    --query 'OriginAccessControl.Id' \
    --output text \
    "${AWS_FLAGS[@]}")
  echo "  ✓ Created OAC: $OAC_ID"
fi
echo

# ─── Helper: create a distribution if not already there ──────
# Args:
#   $1  bucket name
#   $2  distribution Comment (used to detect existing)
#   $3  "spa"|"static" — controls 403/404 error-response handling
# Prints the distribution ID on stdout.
create_distribution_if_missing() {
  local bucket="$1"
  local comment="$2"
  local kind="$3"

  local existing
  existing=$(aws cloudfront list-distributions \
    --query "DistributionList.Items[?Comment=='$comment'].Id | [0]" \
    --output text \
    "${AWS_FLAGS[@]}" 2>/dev/null || echo "None")

  if [ "$existing" != "None" ] && [ -n "$existing" ]; then
    local existing_origin expected_origin
    existing_origin=$(aws cloudfront get-distribution --id "$existing" \
      --query 'Distribution.DistributionConfig.Origins.Items[0].DomainName' \
      --output text "${AWS_FLAGS[@]}")
    expected_origin="${bucket}.s3.${AWS_REGION}.amazonaws.com"
    if [ "$existing_origin" != "$expected_origin" ]; then
      echo "✗ Staging distribution '$comment' already points to '$existing_origin', not '$expected_origin'. Refusing to reuse it." >&2
      return 1
    fi
    echo "$existing"
    return
  fi

  local origin_domain="${bucket}.s3.${AWS_REGION}.amazonaws.com"
  local origin_id="S3-${bucket}"
  local caller_ref="plusquam-${bucket}-$(date +%s)"

  # SPA error routing: 403/404 from S3 become 200 /index.html so React Router can take over.
  local error_responses
  if [ "$kind" = "spa" ]; then
    error_responses='{
      "Quantity": 2,
      "Items": [
        {"ErrorCode": 403, "ResponsePagePath": "/index.html", "ResponseCode": "200", "ErrorCachingMinTTL": 10},
        {"ErrorCode": 404, "ResponsePagePath": "/index.html", "ResponseCode": "200", "ErrorCachingMinTTL": 10}
      ]
    }'
  else
    error_responses='{"Quantity": 0, "Items": []}'
  fi

  local config
  config=$(cat <<EOF
{
  "CallerReference": "$caller_ref",
  "Comment": "$comment",
  "Enabled": true,
  "DefaultRootObject": "index.html",
  "Origins": {
    "Quantity": 1,
    "Items": [{
      "Id": "$origin_id",
      "DomainName": "$origin_domain",
      "OriginPath": "",
      "CustomHeaders": {"Quantity": 0},
      "S3OriginConfig": {"OriginAccessIdentity": ""},
      "OriginAccessControlId": "$OAC_ID",
      "ConnectionAttempts": 3,
      "ConnectionTimeout": 10
    }]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "$origin_id",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": {
      "Quantity": 2,
      "Items": ["GET", "HEAD"],
      "CachedMethods": {"Quantity": 2, "Items": ["GET", "HEAD"]}
    },
    "Compress": true,
    "CachePolicyId": "$MANAGED_CACHE_POLICY_ID",
    "ResponseHeadersPolicyId": "$SECURITY_HEADERS_POLICY_ID"
  },
  "CustomErrorResponses": $error_responses,
  "PriceClass": "PriceClass_100",
  "HttpVersion": "http2and3",
  "IsIPV6Enabled": true,
  "ViewerCertificate": {
    "CloudFrontDefaultCertificate": true,
    "MinimumProtocolVersion": "TLSv1.2_2021"
  }
}
EOF
)

  aws cloudfront create-distribution \
    --distribution-config "$config" \
    --query 'Distribution.Id' \
    --output text \
    "${AWS_FLAGS[@]}"
}

echo "▸ Static distribution (landing + signin)…"
STATIC_DIST_ID=$(create_distribution_if_missing "$STATIC_BUCKET" "$DIST_STATIC_COMMENT" "static")
echo "  ✓ Distribution ID: $STATIC_DIST_ID"
echo

echo "▸ App distribution (SPA — 403/404 → /index.html for client routing)…"
APP_DIST_ID=$(create_distribution_if_missing "$APP_BUCKET" "$DIST_APP_COMMENT" "spa")
echo "  ✓ Distribution ID: $APP_DIST_ID"
echo

# Existing distributions are also updated so rerunning this setup applies the
# policy instead of silently leaving older distributions without the headers.
attach_security_headers_policy() {
  local dist_id="$1"
  local current_file updated_file etag current_policy
  current_file=$(mktemp)
  updated_file=$(mktemp)

  aws cloudfront get-distribution-config --id "$dist_id" \
    --output json "${AWS_FLAGS[@]}" > "$current_file"
  etag=$(python3 - "$current_file" <<'PY'
import json, sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["ETag"])
PY
)
  current_policy=$(python3 - "$current_file" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
print(data["DistributionConfig"]["DefaultCacheBehavior"].get("ResponseHeadersPolicyId", ""))
PY
)

  if [ "$current_policy" = "$SECURITY_HEADERS_POLICY_ID" ]; then
    echo "  ✓ Security headers already attached: $dist_id"
  else
    python3 - "$current_file" "$updated_file" "$SECURITY_HEADERS_POLICY_ID" <<'PY'
import json, sys
source, destination, policy_id = sys.argv[1:]
data = json.load(open(source, encoding="utf-8"))
config = data["DistributionConfig"]
config["DefaultCacheBehavior"]["ResponseHeadersPolicyId"] = policy_id
with open(destination, "w", encoding="utf-8") as output:
    json.dump(config, output)
PY
    aws cloudfront update-distribution --id "$dist_id" --if-match "$etag" \
      --distribution-config "file://$updated_file" \
      "${AWS_FLAGS[@]}" >/dev/null
    echo "  ✓ Attached security headers policy: $dist_id"
  fi

  rm -f "$current_file" "$updated_file"
}

echo "▸ Attaching security headers to both distributions…"
attach_security_headers_policy "$STATIC_DIST_ID"
attach_security_headers_policy "$APP_DIST_ID"
echo

# ─── Helper: bucket policy granting CloudFront read ──────────
put_bucket_policy() {
  local bucket="$1"
  local dist_id="$2"
  local dist_arn="arn:aws:cloudfront::${AWS_CALLER_ACCOUNT}:distribution/${dist_id}"

  local policy
  policy=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowCloudFrontServicePrincipalReadOnly",
    "Effect": "Allow",
    "Principal": {"Service": "cloudfront.amazonaws.com"},
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::${bucket}/*",
    "Condition": {"StringEquals": {"AWS:SourceArn": "${dist_arn}"}}
  }]
}
EOF
)
  aws s3api put-bucket-policy --bucket "$bucket" --policy "$policy" "${AWS_FLAGS[@]}"
  echo "  ✓ Policy set on s3://$bucket → $dist_id"
}

echo "▸ Bucket policies (grant CloudFront read via OAC)…"
put_bucket_policy "$STATIC_BUCKET" "$STATIC_DIST_ID"
put_bucket_policy "$APP_BUCKET"    "$APP_DIST_ID"
echo

# ─── Distribution domain names for the summary ──────────────
STATIC_DOMAIN=$(aws cloudfront get-distribution --id "$STATIC_DIST_ID" \
  --query 'Distribution.DomainName' --output text "${AWS_FLAGS[@]}")
APP_DOMAIN=$(aws cloudfront get-distribution --id "$APP_DIST_ID" \
  --query 'Distribution.DomainName' --output text "${AWS_FLAGS[@]}")

cat <<SUMMARY

✓ CloudFront setup complete.

Distributions are deploying — globally available in 5–15 minutes.

  Static:  https://${STATIC_DOMAIN}
           ID: $STATIC_DIST_ID
  App:     https://${APP_DOMAIN}
           ID: $APP_DIST_ID

Save the app distribution ID for the deploy script:

  export CLOUDFRONT_DIST_ID=$APP_DIST_ID
  AWS_PROFILE=${AWS_PROFILE:-<default>} \\
  STATIC_BUCKET=$STATIC_BUCKET \\
  APP_BUCKET=$APP_BUCKET \\
  CLOUDFRONT_DIST_ID=\$CLOUDFRONT_DIST_ID \\
  ./scripts/deploy.sh

For staging, use the CloudFront-provided URLs printed above. If the client later
requests custom staging domains, configure a staging-only ACM certificate in
us-east-1 and attach only those staging hostnames to these distributions.
SUMMARY
