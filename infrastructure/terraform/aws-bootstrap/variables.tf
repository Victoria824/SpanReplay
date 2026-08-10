variable "aws_region" {
  description = "AWS region for Terraform state and the SpanReplay deployment."
  type        = string
  default     = "ca-central-1"
}

variable "github_repository" {
  description = "GitHub owner/repository allowed to request deployment credentials."
  type        = string
  default     = "Victoria824/SpanReplay"
}

variable "state_bucket_name" {
  description = "Globally unique S3 bucket for Terraform state."
  type        = string
}

variable "deploy_role_name" {
  description = "IAM role assumed by protected GitHub environments."
  type        = string
  default     = "spanreplay-github-deploy"
}

variable "github_oidc_provider_arn" {
  description = "Existing GitHub Actions OIDC provider ARN. Leave null to create it."
  type        = string
  default     = null
  nullable    = true
}

variable "eks_cluster_name" {
  description = "Existing EKS cluster to authorize for deployment. Leave null to skip EKS access configuration."
  type        = string
  default     = null
  nullable    = true
}

variable "eks_oidc_provider_arn" {
  description = "Existing IAM OIDC provider for the EKS issuer. Leave null to create it when eks_cluster_name is set."
  type        = string
  default     = null
  nullable    = true
}

variable "resource_name_prefix" {
  description = "Prefix used to constrain deploy-role IAM, ECR, KMS, and S3 permissions."
  type        = string
  default     = "spanreplay"
}
