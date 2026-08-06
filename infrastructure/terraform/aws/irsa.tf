locals {
  oidc_hostpath = trimprefix(var.eks_oidc_issuer_url, "https://")
}

data "aws_iam_policy_document" "gateway_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [var.eks_oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_hostpath}:sub"
      values   = ["system:serviceaccount:${var.kubernetes_namespace}:${var.kubernetes_service_account}"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_hostpath}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "gateway" {
  name               = "spanreplay-${var.environment}-gateway"
  assume_role_policy = data.aws_iam_policy_document.gateway_assume_role.json
}

data "aws_iam_policy_document" "replay_access" {
  statement {
    sid       = "ListReplayPrefix"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.replays.arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["replays/*"]
    }
  }
  statement {
    sid       = "ReadWriteReplayObjects"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.replays.arn}/replays/*"]
  }
  statement {
    sid       = "UseReplayKmsKey"
    effect    = "Allow"
    actions   = ["kms:Decrypt", "kms:DescribeKey", "kms:Encrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.replays.arn]
  }
}

resource "aws_iam_role_policy" "gateway_replays" {
  name   = "replay-evidence"
  role   = aws_iam_role.gateway.id
  policy = data.aws_iam_policy_document.replay_access.json
}
