resource "aws_kms_key" "replays" {
  description             = "SpanReplay evidence encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "replays" {
  name          = "alias/spanreplay-${var.environment}"
  target_key_id = aws_kms_key.replays.key_id
}

resource "aws_s3_bucket" "replays" {
  bucket = var.replay_bucket_name
}

resource "aws_s3_bucket_public_access_block" "replays" {
  bucket                  = aws_s3_bucket.replays.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "replays" {
  bucket = aws_s3_bucket.replays.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "replays" {
  bucket = aws_s3_bucket.replays.id
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.replays.arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "replays" {
  bucket     = aws_s3_bucket.replays.id
  depends_on = [aws_s3_bucket_versioning.replays]
  rule {
    id     = "privacy-retention"
    status = "Enabled"
    filter {}
    expiration { days = var.replay_retention_days }
    noncurrent_version_expiration { noncurrent_days = 1 }
  }
}
