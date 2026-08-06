data "aws_caller_identity" "current" {}

data "aws_eks_cluster" "existing" {
  count = var.eks_cluster_name == null ? 0 : 1
  name  = var.eks_cluster_name
}

data "tls_certificate" "github" {
  count = var.github_oidc_provider_arn == null ? 1 : 0
  url   = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_openid_connect_provider" "github" {
  count           = var.github_oidc_provider_arn == null ? 1 : 0
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github[0].certificates[0].sha1_fingerprint]
}

data "tls_certificate" "eks" {
  count = var.eks_cluster_name != null && var.eks_oidc_provider_arn == null ? 1 : 0
  url   = data.aws_eks_cluster.existing[0].identity[0].oidc[0].issuer
}

resource "aws_iam_openid_connect_provider" "eks" {
  count           = var.eks_cluster_name != null && var.eks_oidc_provider_arn == null ? 1 : 0
  url             = data.aws_eks_cluster.existing[0].identity[0].oidc[0].issuer
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.eks[0].certificates[0].sha1_fingerprint]
}

locals {
  github_oidc_provider_arn = coalesce(
    var.github_oidc_provider_arn,
    try(aws_iam_openid_connect_provider.github[0].arn, null),
  )
  github_environment_subjects = [
    "repo:${var.github_repository}:environment:aws-production",
    "repo:${var.github_repository}:environment:datadog-verification",
  ]
  account_id = data.aws_caller_identity.current.account_id
  eks_oidc_issuer_url = var.eks_cluster_name == null ? null : data.aws_eks_cluster.existing[0].identity[0].oidc[0].issuer
  eks_oidc_provider_arn = var.eks_cluster_name == null ? null : coalesce(
    var.eks_oidc_provider_arn,
    try(aws_iam_openid_connect_provider.eks[0].arn, null),
  )
}

resource "aws_s3_bucket" "terraform_state" {
  bucket = var.state_bucket_name

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket                  = aws_s3_bucket.terraform_state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
    bucket_key_enabled = true
  }
}

data "aws_iam_policy_document" "github_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.github_environment_subjects
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name                 = var.deploy_role_name
  assume_role_policy   = data.aws_iam_policy_document.github_assume_role.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "github_deploy" {
  statement {
    sid    = "TerraformState"
    effect = "Allow"
    actions = [
      "s3:GetBucketVersioning",
      "s3:GetObject",
      "s3:ListBucket",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = [
      aws_s3_bucket.terraform_state.arn,
      "${aws_s3_bucket.terraform_state.arn}/*",
    ]
  }

  statement {
    sid    = "ReplayBuckets"
    effect = "Allow"
    actions = [
      "s3:CreateBucket",
      "s3:DeleteBucket",
      "s3:GetBucket*",
      "s3:ListBucket",
      "s3:PutBucket*",
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = [
      "arn:aws:s3:::*${var.resource_name_prefix}*",
      "arn:aws:s3:::*${var.resource_name_prefix}*/*",
    ]
  }

  statement {
    sid    = "SpanReplayIAM"
    effect = "Allow"
    actions = [
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:GetRole",
      "iam:ListRolePolicies",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:PutRolePolicy",
      "iam:GetRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:PassRole",
    ]
    resources = ["arn:aws:iam::${local.account_id}:role/${var.resource_name_prefix}-*"]
  }

  statement {
    sid    = "SpanReplayKMS"
    effect = "Allow"
    actions = [
      "kms:CreateKey",
      "kms:DescribeKey",
      "kms:EnableKeyRotation",
      "kms:GetKeyPolicy",
      "kms:GetKeyRotationStatus",
      "kms:ListResourceTags",
      "kms:PutKeyPolicy",
      "kms:ScheduleKeyDeletion",
      "kms:TagResource",
      "kms:UntagResource",
      "kms:CreateAlias",
      "kms:DeleteAlias",
      "kms:ListAliases",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "SpanReplayECR"
    effect = "Allow"
    actions = [
      "ecr:CreateRepository",
      "ecr:DeleteRepository",
      "ecr:DescribeRepositories",
      "ecr:GetRepositoryPolicy",
      "ecr:PutImageScanningConfiguration",
      "ecr:PutImageTagMutability",
      "ecr:PutLifecyclePolicy",
      "ecr:GetLifecyclePolicy",
      "ecr:DeleteLifecyclePolicy",
      "ecr:TagResource",
      "ecr:UntagResource",
      "ecr:BatchCheckLayerAvailability",
      "ecr:CompleteLayerUpload",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = ["arn:aws:ecr:${var.aws_region}:${local.account_id}:repository/${var.resource_name_prefix}/*"]
  }

  statement {
    sid       = "ECRAuthorization"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid       = "DescribeEKS"
    effect    = "Allow"
    actions   = ["eks:DescribeCluster"]
    resources = ["arn:aws:eks:${var.aws_region}:${local.account_id}:cluster/${coalesce(var.eks_cluster_name, "__not_configured__")}"]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "spanreplay-deployment"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}

resource "aws_eks_access_entry" "github_deploy" {
  count         = var.eks_cluster_name == null ? 0 : 1
  cluster_name  = var.eks_cluster_name
  principal_arn = aws_iam_role.github_deploy.arn
  type          = "STANDARD"
}

resource "aws_eks_access_policy_association" "github_deploy" {
  count         = var.eks_cluster_name == null ? 0 : 1
  cluster_name  = var.eks_cluster_name
  principal_arn = aws_iam_role.github_deploy.arn
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
  access_scope { type = "cluster" }

  depends_on = [aws_eks_access_entry.github_deploy]
}
