locals {
  notifications = join(" ", var.notification_targets)
  common_tags = [
    "platform:spanreplay",
    "team:ai-platform",
    "env:${var.environment}",
    "managed-by:terraform",
  ]
}

resource "datadog_monitor" "workflow_failures" {
  name    = "[SpanReplay] Sustained production AI workflow failures"
  type    = "metric alert"
  query   = "sum(last_5m):sum:ai.workflow.runs{env:${var.environment},workflow_status:failed}.as_count() > 5"
  message = <<-EOT
    Production AI workflows are failing repeatedly. Correlate by trace_id, identify the first failing span, and follow the incident playbook.
    ${local.notifications}
  EOT

  monitor_thresholds {
    critical = 5
    warning  = 2
  }

  evaluation_delay    = 60
  notify_no_data      = false
  require_full_window = false
  include_tags        = true
  tags                = local.common_tags
}

resource "datadog_monitor" "workflow_p95_latency" {
  name    = "[SpanReplay] Workflow p95 latency exceeds 3 seconds"
  type    = "metric alert"
  query   = "percentile(last_10m):p95:ai.workflow.duration{env:${var.environment}} > 3000"
  message = <<-EOT
    End-to-end workflow latency is outside the 3-second objective. Compare gateway, retrieval, provider, and tool spans before scaling.
    ${local.notifications}
  EOT

  monitor_thresholds {
    critical = 3000
    warning  = 2000
  }

  notify_no_data      = false
  require_full_window = false
  include_tags        = true
  tags                = local.common_tags
}

resource "datadog_monitor" "cost_spike" {
  name    = "[SpanReplay] Estimated model cost spike"
  type    = "metric alert"
  query   = "sum(last_15m):sum:ai.workflow.estimated.cost{env:${var.environment}} > 10"
  message = <<-EOT
    Estimated model spend exceeded the 15-minute guardrail. Inspect token use by model, prompt version, retry count, and agent step count.
    ${local.notifications}
  EOT

  monitor_thresholds {
    critical = 10
    warning  = 5
  }

  notify_no_data      = false
  require_full_window = false
  include_tags        = true
  tags                = local.common_tags
}

resource "datadog_monitor" "validation_failures" {
  name    = "[SpanReplay] AI validation failures elevated"
  type    = "metric alert"
  query   = "sum(last_10m):sum:ai.validation.failures{env:${var.environment}}.as_count() > 10"
  message = <<-EOT
    Grounding or policy validation is rejecting agent output. Break down by validation.reason and prompt version before changing the threshold.
    ${local.notifications}
  EOT

  monitor_thresholds {
    critical = 10
    warning  = 5
  }

  notify_no_data      = false
  require_full_window = false
  include_tags        = true
  tags                = local.common_tags
}

resource "datadog_service_level_objective" "workflow_availability" {
  name        = "SpanReplay production AI workflow availability"
  type        = "monitor"
  description = "Successful production AI workflows excluding intentionally blocked policy decisions."
  monitor_ids = [datadog_monitor.workflow_failures.id]
  tags        = local.common_tags

  thresholds {
    timeframe = "7d"
    target    = 99.0
    warning   = 99.5
  }

  thresholds {
    timeframe = "30d"
    target    = 99.0
    warning   = 99.5
  }
}

resource "datadog_dashboard_json" "production_ai" {
  dashboard = templatefile("${path.module}/dashboard.json.tftpl", {
    environment = var.environment
  })
}
