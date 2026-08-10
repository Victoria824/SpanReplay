output "aws_account_id" {
  value = data.aws_caller_identity.current.account_id
}

output "terraform_state_bucket" {
  value = aws_s3_bucket.terraform_state.id
}

output "github_deploy_role_arn" {
  value = aws_iam_role.github_deploy.arn
}

output "github_oidc_provider_arn" {
  value = local.github_oidc_provider_arn
}

output "eks_oidc_provider_arn" {
  value = local.eks_oidc_provider_arn
}

output "eks_oidc_issuer_url" {
  value = local.eks_oidc_issuer_url
}
