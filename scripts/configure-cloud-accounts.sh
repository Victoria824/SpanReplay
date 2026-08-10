#!/usr/bin/env bash
set -euo pipefail

repository="${GITHUB_REPOSITORY:-Victoria824/SpanReplay}"

required=(
  AWS_DEPLOY_ROLE_ARN
  AWS_REGION
  TF_STATE_BUCKET
  REPLAY_BUCKET_NAME
  EKS_OIDC_PROVIDER_ARN
  EKS_OIDC_ISSUER_URL
  EKS_CLUSTER_NAME
  AUTH0_ISSUER_BASE_URL
  AUTH0_AUDIENCE
  DD_API_KEY
  DD_APP_KEY
)

missing=()
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then missing+=("$name"); fi
done
if ((${#missing[@]})); then
  echo "Missing required environment variables: ${missing[*]}" >&2
  exit 2
fi

command -v gh >/dev/null || { echo "gh is required" >&2; exit 2; }
command -v aws >/dev/null || { echo "aws is required" >&2; exit 2; }
gh auth status >/dev/null
aws sts get-caller-identity --output json >/dev/null

for environment in aws-production datadog-verification; do
  gh api --method PUT "repos/${repository}/environments/${environment}" >/dev/null
done

set_variable() {
  local environment="$1" name="$2" value="$3"
  gh variable set "$name" --env "$environment" --repo "$repository" --body "$value"
}

for environment in aws-production datadog-verification; do
  set_variable "$environment" AWS_DEPLOY_ROLE_ARN "$AWS_DEPLOY_ROLE_ARN"
  set_variable "$environment" AWS_REGION "$AWS_REGION"
  set_variable "$environment" TF_STATE_BUCKET "$TF_STATE_BUCKET"
done

set_variable aws-production REPLAY_BUCKET_NAME "$REPLAY_BUCKET_NAME"
set_variable aws-production EKS_OIDC_PROVIDER_ARN "$EKS_OIDC_PROVIDER_ARN"
set_variable aws-production EKS_OIDC_ISSUER_URL "$EKS_OIDC_ISSUER_URL"
set_variable aws-production EKS_CLUSTER_NAME "$EKS_CLUSTER_NAME"
set_variable aws-production AUTH0_ISSUER_BASE_URL "$AUTH0_ISSUER_BASE_URL"
set_variable aws-production AUTH0_AUDIENCE "$AUTH0_AUDIENCE"
set_variable datadog-verification DD_SITE "${DD_SITE:-datadoghq.com}"
set_variable datadog-verification DD_API_URL "${DD_API_URL:-https://api.datadoghq.com/}"

printf '%s' "$DD_API_KEY" | gh secret set DD_API_KEY --env datadog-verification --repo "$repository"
printf '%s' "$DD_APP_KEY" | gh secret set DD_APP_KEY --env datadog-verification --repo "$repository"

echo "Configured protected GitHub environments for ${repository}."
echo "No long-lived AWS key was uploaded; workflows use GitHub OIDC role assumption."
