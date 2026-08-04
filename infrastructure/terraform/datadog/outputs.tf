output "dashboard_id" {
  description = "ID of the managed SpanReplay dashboard."
  value       = datadog_dashboard_json.production_ai.id
}

output "slo_id" {
  description = "ID of the managed workflow availability SLO."
  value       = datadog_service_level_objective.workflow_availability.id
}

