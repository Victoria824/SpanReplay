# Datadog integration

## Verified trial result

The protected workflow passed against a real Datadog US1 trial organization on August 10, 2026. [Workflow run #31409061260](https://github.com/Victoria824/SpanReplay/actions/runs/31409061260) observed all four signals through Datadog's APIs:

- one indexed trace containing `api-gateway`, `agent-service`, and `retrieval-service`;
- 8 structured logs correlated to the trace;
- 1 `spanreplay.workflow.total` metric series tagged for the verification environment; and
- 2 grouped backend Error Tracking issues.

The workflow uploaded a digest-addressed 30-day artifact and the assertion output is checked in at [`evidence/datadog-verification.json`](../evidence/datadog-verification.json). The checked-in file contains trace identifiers and counts, never API or application keys.

## Local OpenTelemetry export

Set Datadog credentials in the shell, not in `.env` committed to Git:

```bash
export DD_API_KEY='...'
export DD_APP_KEY='...'
export DD_SITE='datadoghq.com'
docker compose -f docker-compose.yml -f docker-compose.datadog.yml up --build -d
npm run verify:datadog
```

Services export OTLP to the collector. The alternate collector configuration forwards traces and metrics to the Datadog Agent; the Agent collects JSON container logs and Datadog correlates them through shared service/environment/version tags and trace identifiers.

The Docker verification path also makes four operational requirements explicit: the Agent receives `HOST_PROC=/proc`, its OTLP gRPC port must pass a readiness probe before the collector starts, the host container-log directory is mounted read-only, and OTLP metric resource attributes are mapped to Datadog tags. A second healthy workflow produces a cumulative-counter delta before the metric assertion runs.

The verifier injects the stable backend exception and polls the official Datadog APIs until it proves all four acceptance conditions: one trace contains gateway/agent/retrieval services, a structured log correlates by trace ID, the workflow metric is queryable, and Error Tracking contains the grouped backend issue. It writes owner-only evidence to `evidence/datadog-verification.json` only after all assertions pass.

For repeatable external evidence, configure the protected GitHub `datadog-verification` environment with `DD_API_KEY`, `DD_APP_KEY`, and optional `DD_SITE`, then run the manual Datadog verification workflow. The application key needs only `apm_read`, `logs_read_data`, `logs_read_index_data`, `metrics_read`, `timeseries_query`, and `error_tracking_read`; it has no write scopes. The environment can require a reviewer so secrets are released only to an approved run.

Select Terraform mode `none` to prove traces, metrics, logs, and Error Tracking without any AWS dependency. Modes `plan` and `apply` use the protected AWS OIDC role and S3 state; `apply` is the only mode that mutates Datadog configuration. `scripts/configure-cloud-accounts.sh` creates both protected environment boundaries and transfers these keys through standard input, so they do not appear in command arguments or repository files.

Indexed-trace verification requires an APM retention rule that retains the generated service-entry spans. For a short-lived, isolated trial organization, the verified run used 100% span and trace retention; production accounts should narrow the query and sampling rates to their traffic and cost budget.

## Provision monitors, SLO, and dashboard

```bash
cd infrastructure/terraform/datadog
export TF_VAR_datadog_api_key="$DD_API_KEY"
export TF_VAR_datadog_app_key='...'
terraform init
terraform plan -var='environment=production'
terraform apply -var='environment=production'
```

The Terraform module creates failure, latency, validation, and cost monitors; a monitor-based workflow availability SLO; and a production AI dashboard. Review thresholds against real traffic before paging anyone.

The Terraform module creates a custom logs pipeline that remaps `service`, `level`, `trace_id`, and `span_id`. Datadog owns pipeline order at the account level, so merge the exported `logs_pipeline_id` into the existing `datadog_logs_pipeline_order`; do not create a second order resource that drops pipelines owned by other teams.

The `error-tracking` failure scenario emits a stable unhandled `TypeError`. Error spans carry `error.type`, `error.message`, `error.stack`, and `error.fingerprint`; the correlated JSON log carries the same normalized fields after secret and email redaction. The Terraform Error Tracking monitor alerts only on new grouped backend issues. Exercise it with:

```bash
curl -sS -X POST http://localhost:4000/api/workflows \
  -H 'content-type: application/json' \
  -d '{"question":"exercise error grouping","scenario":"error-tracking"}'
```

For provider-native LLM Observability, layer vendor instrumentation on top of—not instead of—the service-level OpenTelemetry contract.
