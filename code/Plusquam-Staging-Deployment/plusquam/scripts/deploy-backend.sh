#!/usr/bin/env bash
#
# plusquam — build and deploy the SAM stack (Lambda + DynamoDB + API Gateway).
#
# Staging-only deployment. Stack name and Stage parameter are pinned so a local
# SAM config cannot redirect this release to production.
#
# Usage:
#   AWS_PROFILE=client-staging \
#   EXPECTED_AWS_ACCOUNT_ID=123456789012 \
#   CORS_ALLOWED_ORIGINS=https://d123.cloudfront.net,https://d456.cloudfront.net \
#   AWS_REGION=eu-central-1 \
#   ./scripts/deploy-backend.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=_common.sh
source "$ROOT/scripts/_common.sh"

API_DIR="$ROOT/api"
SECRET_NAME="plusquam/model-provider-api-key-staging"
LLM_PROVIDER="${LLM_PROVIDER:-dashscope}"
LLM_MODEL="${LLM_MODEL:-qwen-plus}"
LLM_TEMPERATURE="${LLM_TEMPERATURE:-0.3}"
ALARM_EMAIL="${ALARM_EMAIL:-}"
CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS:-}"

if [ -z "$CORS_ALLOWED_ORIGINS" ]; then
  echo "✗ CORS_ALLOWED_ORIGINS is required for staging. Run deploy-all.sh or set the exact staging origins."
  exit 1
fi

echo "▸ plusquam backend deploy"
print_aws_context
echo "  api dir:  $API_DIR"
echo "  stage:    $STAGE"
echo "  stack:    $STACK_NAME"
echo "  secret:   $SECRET_NAME"
echo

# ─── Pre-flight: SAM CLI present ─────────────────────────────
command -v sam >/dev/null 2>&1 || {
  echo "✗ SAM CLI not found."
  echo "  Install: brew install aws-sam-cli   (macOS)"
  echo "       or: pip install aws-sam-cli"
  exit 1
}

command -v python3 >/dev/null 2>&1 || {
  echo "✗ Python 3 is required."
  exit 1
}

command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 || {
  echo "✗ A running Docker installation is required to build the Lambda package for its configured arm64 runtime."
  exit 1
}

verify_aws_auth
echo

# ─── Pre-flight: selected provider API key secret ────────────
echo "▸ Verifying selected model-provider API key secret…"
if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" "${AWS_FLAGS[@]}" >/dev/null 2>&1; then
  echo "  ✓ Secret exists: $SECRET_NAME"
else
  echo "  ✗ Secret '$SECRET_NAME' not found in this account/region."
  echo
  read -r -p "  Create it now? (y/N): " confirm
  if [[ $confirm =~ ^[Yy]$ ]]; then
    # -s suppresses echo while typing
    read -r -s -p "  Paste API key for the selected LlmProvider: " api_key
    echo
    if [ -z "$api_key" ]; then
      echo "  ✗ API key cannot be empty. Aborting."
      exit 1
    fi
    secret_file=$(mktemp)
    chmod 600 "$secret_file"
    trap 'rm -f "${secret_file:-}"' EXIT
    printf '%s' "$api_key" > "$secret_file"
    api_key=""
    aws secretsmanager create-secret \
      --name "$SECRET_NAME" \
      --secret-string "file://$secret_file" \
      --description "Selected model-provider API key — plusquam assessment pipeline" \
      "${AWS_FLAGS[@]}" \
      >/dev/null
    rm -f "$secret_file"
    trap - EXIT
    echo "  ✓ Secret created"
  else
    echo "    Create manually then re-run this script:"
    echo "      aws secretsmanager create-secret \\"
    echo "        --name $SECRET_NAME \\"
    echo "        --secret-string '<provider API key>' \\"
    echo "        --region $AWS_REGION$PROFILE_FRAG"
    exit 1
  fi
fi
echo

cd "$API_DIR"

# ─── sam build ───────────────────────────────────────────────
echo "▸ sam build…"
sam build --use-container
echo

# ─── sam deploy ──────────────────────────────────────────────
echo "▸ Deploying isolated staging stack ($STACK_NAME)…"
SAM_OVERRIDES=(
  "Stage=staging"
  "LlmApiKeySecretName=$SECRET_NAME"
  "LlmProvider=$LLM_PROVIDER"
  "LlmModel=$LLM_MODEL"
  "LlmTemperature=$LLM_TEMPERATURE"
  "CorsAllowedOrigins=$CORS_ALLOWED_ORIGINS"
)
sam deploy \
  --stack-name "$STACK_NAME" \
  --resolve-s3 \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides "${SAM_OVERRIDES[@]}" \
  --no-fail-on-empty-changeset \
  "${AWS_FLAGS[@]}"
echo

# ─── Print outputs ───────────────────────────────────────────
echo "▸ Setting Lambda log retention to 30 days…"
LAMBDA_NAMES=$(aws cloudformation list-stack-resources --stack-name "$STACK_NAME" \
  --query "StackResourceSummaries[?ResourceType=='AWS::Lambda::Function'].PhysicalResourceId" \
  --output text "${AWS_FLAGS[@]}")
for function_name in $LAMBDA_NAMES; do
  log_group="/aws/lambda/${function_name}"
  aws logs create-log-group --log-group-name "$log_group" "${AWS_FLAGS[@]}" 2>/dev/null || true
  aws logs put-retention-policy --log-group-name "$log_group" --retention-in-days 30 "${AWS_FLAGS[@]}"
done
echo

echo "▸ Stack outputs ($STACK_NAME):"
aws cloudformation describe-stacks --stack-name "$STACK_NAME" "${AWS_FLAGS[@]}" \
  --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' --output table 2>/dev/null \
  || echo "  (could not read stack outputs; check stack name)"

API_URL=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" "${AWS_FLAGS[@]}" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text 2>/dev/null || echo "")

cat <<DONE

✓ Backend deployed.

  API URL:  ${API_URL:-<not detected>}

Next steps:

  1. The full staging deployment script builds the frontend with this API URL.
     If deploying the frontend separately, run:
       ./scripts/deploy.sh

  Tail Lambda logs:
       sam logs --stack-name $STACK_NAME --tail ${AWS_REGION:+--region $AWS_REGION}
DONE
