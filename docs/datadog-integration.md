# Datadog integration

## Local OpenTelemetry export

Set Datadog credentials in the shell, not in `.env` committed to Git:

```bash
export DD_API_KEY='...'
export DD_SITE='datadoghq.com'
docker compose -f docker-compose.yml -f docker-compose.datadog.yml up --build
```

Services export OTLP to the collector. The alternate collector configuration forwards traces and metrics to the Datadog Agent; the Agent collects JSON container logs and Datadog correlates them through shared service/environment/version tags and trace identifiers.

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

For logs-only deployments, configure log-to-trace remapping for `trace_id` and confirm field names against your Datadog pipeline. For provider-native LLM Observability, layer vendor instrumentation on top of—not instead of—the service-level OpenTelemetry contract.

