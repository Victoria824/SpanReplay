resource "datadog_logs_custom_pipeline" "spanreplay" {
  name        = "SpanReplay service correlation"
  description = "Normalizes SpanReplay JSON logs for trace correlation and error tracking. Add this ID to the account-owned pipeline order."
  is_enabled  = true
  tags        = local.common_tags

  filter {
    query = "service:(api-gateway OR agent-service OR retrieval-service)"
  }

  processor {
    service_remapper {
      name       = "Use the OpenTelemetry service name"
      sources    = ["service"]
      is_enabled = true
    }
  }

  processor {
    status_remapper {
      name       = "Normalize Pino severity"
      sources    = ["level"]
      is_enabled = true
    }
  }

  processor {
    trace_id_remapper {
      name       = "Correlate logs to OpenTelemetry traces"
      sources    = ["trace_id"]
      is_enabled = true
    }
  }

  processor {
    span_id_remapper {
      name       = "Correlate logs to OpenTelemetry spans"
      sources    = ["span_id"]
      is_enabled = true
    }
  }
}
