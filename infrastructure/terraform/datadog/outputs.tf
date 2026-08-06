output "dashboard_id" {
  description = "ID of the managed SpanReplay dashboard."
  value       = datadog_dashboard_json.production_ai.id
}

output "slo_id" {
  description = "ID of the managed workflow availability SLO."
  value       = datadog_service_level_objective.workflow_availability.id
}

output "logs_pipeline_id" {
  description = "Pipeline ID to merge into the account-owned datadog_logs_pipeline_order resource."
  value       = datadog_logs_custom_pipeline.spanreplay.id
}
