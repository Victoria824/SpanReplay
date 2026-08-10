variable "aws_region" {
  description = "AWS region hosting the existing EKS cluster and replay evidence."
  type        = string
  default     = "ca-central-1"
}

variable "environment" {
  description = "Deployment environment."
  type        = string
  default     = "production"
}

variable "replay_bucket_name" {
  description = "Globally unique S3 bucket name for encrypted replay evidence."
  type        = string
}

variable "eks_oidc_provider_arn" {
  description = "ARN of the IAM OIDC provider associated with the existing EKS cluster."
  type        = string
}

variable "eks_oidc_issuer_url" {
  description = "Issuer URL of the existing EKS cluster, including https://."
  type        = string
}

variable "kubernetes_namespace" {
  type    = string
  default = "spanreplay"
}

variable "kubernetes_service_account" {
  type    = string
  default = "api-gateway"
}

variable "replay_retention_days" {
  description = "Days before replay evidence expires. Align with the approved privacy policy."
  type        = number
  default     = 30
}
