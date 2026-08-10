# AWS account bootstrap

This one-time module establishes the trust boundary used by the protected deployment workflows. Run it with an AWS administrator session; it intentionally keeps local state because the remote-state bucket does not exist until this module completes.

```bash
terraform init
terraform plan -out=bootstrap.tfplan \
  -var='state_bucket_name=YOUR-UNIQUE-spanreplay-tfstate' \
  -var='eks_cluster_name=YOUR-EXISTING-EKS-CLUSTER'
terraform apply bootstrap.tfplan
```

If the account already has the GitHub Actions OIDC provider, pass its ARN through `github_oidc_provider_arn`. If the EKS issuer already has an IAM OIDC provider, pass `eks_oidc_provider_arn`; otherwise the module creates one and exports both values required by the production module. The GitHub role trust policy accepts tokens only from the `aws-production` and `datadog-verification` environments in `Victoria824/SpanReplay`.

Review the generated IAM policy against your organization's permission boundary before apply. The module can optionally grant the deploy role EKS cluster-admin access because the workflow installs workloads; omit `eks_cluster_name` if cluster access is managed separately.
