# AWS production dependencies

This module deliberately integrates with an existing EKS cluster instead of silently creating a networking and cluster estate. It provisions encrypted, versioned S3 replay storage, a least-privilege IRSA role for the gateway, and immutable/scanned ECR repositories.

Create the remote-state S3 bucket once through the organization's Terraform bootstrap process. Both AWS and Datadog modules declare an empty S3 backend and receive bucket/key/region plus native lockfile configuration at `terraform init`; application infrastructure must never be applied from ephemeral local state.

```bash
terraform init
terraform plan \
  -var='replay_bucket_name=company-spanreplay-production' \
  -var='eks_oidc_provider_arn=arn:aws:iam::123456789012:oidc-provider/oidc.eks.ca-central-1.amazonaws.com/id/EXAMPLE' \
  -var='eks_oidc_issuer_url=https://oidc.eks.ca-central-1.amazonaws.com/id/EXAMPLE'
```

Pass the outputs into the Kubernetes production overlay. The gateway uses the AWS SDK default credential chain, so EKS web identity credentials are short-lived and no AWS access key is stored in a Secret.
