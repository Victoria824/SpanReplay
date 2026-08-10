# ADR 001: OpenTelemetry is the application boundary

- Status: accepted
- Decision date: 2026-08-04

## Context

Service teams need consistent instrumentation while operators may use Tempo/Prometheus/Loki locally and Datadog in production. Coupling application code directly to one backend makes migration, testing, and shared governance harder.

## Decision

Application code emits OpenTelemetry traces and metrics and correlated JSON logs through the reusable Node package. Collectors perform routing and backend-specific translation. Datadog dashboards, monitors, and log pipelines remain infrastructure code rather than application dependencies.

## Consequences

The application has a stable vendor-neutral contract and local integration tests can assert all three signals. Backend-only features such as Error Tracking still require normalized `error.*` fields and Terraform. Collector configuration becomes production infrastructure and must be capacity-tested, monitored, and rolled back like any other service.
