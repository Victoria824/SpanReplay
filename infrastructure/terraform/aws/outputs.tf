output "replay_bucket" { value = aws_s3_bucket.replays.id }
output "replay_kms_key_arn" { value = aws_kms_key.replays.arn }
output "gateway_irsa_role_arn" { value = aws_iam_role.gateway.arn }
output "service_ecr_url" { value = aws_ecr_repository.service.repository_url }
output "console_ecr_url" { value = aws_ecr_repository.console.repository_url }
