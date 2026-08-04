# Tagging taxonomy

Use a small, governed tag set so service maps, monitors, costs, and ownership remain queryable.

## Universal tags

| Tag | Examples | Cardinality |
| --- | --- | --- |
| `env` | `production`, `staging` | very low |
| `service` | `api-gateway`, `agent-service` | low |
| `version` | release or commit | bounded |
| `team` | `ai-platform` | low |
| `platform` | `spanreplay` | one value |

## AI workflow tags

Allowed on metrics: workflow status, scenario, model, provider, prompt version, tool name, bounded validation reason, replay mode. Review additions for cardinality before merging.

Allowed only on traces/logs: trace ID, replay parent trace ID, retrieved document identifiers, ticket identifier, service instance, exception detail.

Forbidden: raw prompt, response, SQL, embeddings, authorization headers, cookies, API keys, email addresses, customer identifiers, unrestricted URLs, and arbitrary tool arguments.

## Ownership

Each service must expose `service.name`, `team`, environment, and version. Monitors should include the same tags and route through team-owned notification handles. Dashboards may template on `env` and `service`, but must not make user-controlled values template dimensions.

