# Cloud account setup

## What is automated

- GHCR publishes multi-architecture service and Console images on `v*` tags or manual dispatch. GitHub's own token is used, so no Docker Hub password is required. Builds include OCI metadata, SBOM, provenance, registry-backed attestation, and immutable SHA tags.
- AWS bootstrap creates the Terraform state bucket, GitHub OIDC provider/role, and optional EKS access entry. The production module then creates replay S3/KMS, IRSA, and ECR resources around an existing EKS cluster.
- Datadog Terraform creates the dashboard, monitors, SLO, log pipeline, and Error Tracking monitor. Its workflow proves trace/log/metric/error correlation through Datadog APIs.

## One-time order

1. Install or start a Docker-compatible runtime and pass `docker version` plus `docker compose config --quiet`.
2. Authenticate `gh auth login` and an AWS administrator session. Run `infrastructure/terraform/aws-bootstrap` after reviewing its plan.
3. Export the bootstrap outputs, EKS/Auth0 values, and newly created Datadog API/application keys under the names accepted by `scripts/configure-cloud-accounts.sh`. Set `DD_SITE` and `DD_API_URL` together for non-US Datadog sites.
4. Run the script. It creates the `aws-production` and `datadog-verification` GitHub environments, stores only Datadog keys as encrypted secrets, and stores non-secret deployment metadata as environment variables.
5. Run the Datadog workflow with Terraform apply disabled first. Review the plan, then rerun with apply enabled. Run AWS `plan`, then `apply`, and use `deploy` only after both plans are approved.

The configuration script expects these shell variables (values shown are placeholders):

```bash
export AWS_DEPLOY_ROLE_ARN='arn:aws:iam::ACCOUNT_ID:role/spanreplay-github-deploy'
export AWS_REGION='ca-central-1'
export TF_STATE_BUCKET='YOUR-UNIQUE-spanreplay-tfstate'
export REPLAY_BUCKET_NAME='YOUR-UNIQUE-spanreplay-production'
export EKS_OIDC_PROVIDER_ARN='BOOTSTRAP_OUTPUT'
export EKS_OIDC_ISSUER_URL='BOOTSTRAP_OUTPUT'
export EKS_CLUSTER_NAME='YOUR-EXISTING-CLUSTER'
export AUTH0_ISSUER_BASE_URL='https://YOUR_TENANT.auth0.com/'
export AUTH0_AUDIENCE='https://spanreplay-api'
export DD_SITE='datadoghq.com'
export DD_API_URL='https://api.datadoghq.com/'
export DD_API_KEY='CREATE_A_SCOPED_DATADOG_API_KEY'
export DD_APP_KEY='CREATE_A_SCOPED_DATADOG_APPLICATION_KEY'
bash scripts/configure-cloud-accounts.sh
```

## Credential rules

- Never upload AWS access keys to GitHub. The workflow exchanges GitHub's short-lived OIDC token for an AWS role session.
- Create a scoped Datadog application key for Terraform/API verification instead of using a personal all-purpose key. Rotate it independently.
- Protect both GitHub environments with required reviewers before production apply/deploy.
- Do not put account IDs, API keys, passwords, or generated `production.env` files in commits or workflow logs.
