# SpanReplay

[![CI](https://github.com/Victoria824/SpanReplay/actions/workflows/ci.yml/badge.svg)](https://github.com/Victoria824/SpanReplay/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Victoria824/SpanReplay/actions/workflows/codeql.yml/badge.svg)](https://github.com/Victoria824/SpanReplay/actions/workflows/codeql.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-enabled-4f62ad.svg)](https://opentelemetry.io/)

**OpenTelemetry observability and privacy-aware failure replay for production AI agents.**

SpanReplay is an executable reference stack for diagnosing LLM and agent workflows across service boundaries. It combines distributed traces, structured logs, AI-specific metrics, SLOs, controlled failure injection, and deterministic replay in one local environment.

It is intentionally vendor-neutral. The default stack uses OpenTelemetry, Tempo, Prometheus, Loki, Vector, and Grafana; an optional Datadog path includes importable dashboards, monitors, and Terraform.

> No model API key is required. The incident lab is deterministic, so every failure can be reproduced in CI and during an interview demo.

## What it proves

- End-to-end context propagation across an API gateway, agent service, retrieval service, and tool boundary.
- AI telemetry for model/provider, prompt version, tokens, estimated cost, retrieval relevance, tool outcomes, validation failures, retries, and replay status.
- Seven reproducible scenarios: healthy, retrieval timeout, irrelevant grounding, provider timeout, tool failure, policy failure, and cost spike.
- Privacy-aware replay records with secret redaction, raw-content retention disabled by default, strict trace identifiers, and atomic file writes.
- Operational artifacts: Grafana and Datadog dashboards, alert rules, SLOs, Kubernetes manifests, Terraform, incident playbooks, and CI.

## Architecture

```mermaid
flowchart LR
  U["Replay Console"] --> G["API Gateway"]
  G --> A["LLM Agent Service"]
  A --> R["Retrieval Service"]
  A --> W["Tool / Worker"]
  G -. "fixture or live replay" .-> A
  G --> S[("Sanitized replay store")]
  G & A & R --> O["OpenTelemetry Collector"]
  O --> T["Tempo traces"]
  O --> P["Prometheus metrics"]
  G & A & R --> V["Vector"] --> L["Loki logs"]
  T & P & L --> D["Grafana / Datadog-compatible views"]
```

## Fastest demo: no Docker, no API key, no ports

```bash
npm install
npm run demo
```

This runs four workflows in process, persists redacted replay fixtures to a temporary directory, replays a tool failure, and prints the comparison.

## Full local stack

Requirements: Docker Engine with Compose v2.

```bash
cp .env.example .env
docker compose up --build
```

Then open:

- Replay Console: <http://localhost:4173>
- Grafana: <http://localhost:3000>
- Prometheus: <http://localhost:9090>
- Tempo API: <http://localhost:3200>

Select a failure scenario, run it, inspect the correlated trace/log/metrics view, and replay the stored evidence. The Console also has a zero-key static preview if the services are unavailable.

For Colima and Kubernetes instructions, see the [deployment guide](docs/deployment.md).

## API walkthrough

```bash
curl -s http://localhost:4000/api/workflows \
  -H 'content-type: application/json' \
  -d '{"question":"How should we respond to an LLM provider timeout?","scenario":"tool-error"}'

curl -s http://localhost:4000/api/replays

curl -s http://localhost:4000/api/replays/<trace-id> \
  -H 'content-type: application/json' \
  -d '{"mode":"fixture"}'
```

## Signals and operational semantics

| Signal | Examples | Why it matters |
| --- | --- | --- |
| Traces | agent invocation, retrieval, model call, tool call, replay step | Identifies the failed dependency and critical path |
| Metrics | workflow duration/status, token use, estimated cost, relevance, tool outcomes | Drives alerts, SLOs, capacity, and cost controls |
| Logs | `trace_id`, service, environment, failure category, prompt version | Correlates evidence without relying on raw prompts |
| Replay | original trace, sanitized fixture, drift comparison | Converts an incident into a deterministic regression test |

The custom attributes follow the OpenTelemetry GenAI semantic-convention naming style where applicable and use the `ai.*` namespace for project-specific signals.

## Privacy model

`SPANREPLAY_REDACT_CONTENT=true` is the default. Raw questions are replaced with `[CONTENT_REDACTED]`, secret-like keys and bearer tokens are sanitized, replay records are written with owner-only permissions, and live replay is disabled when content was not retained. Fixture replay reproduces control flow from sanitized evidence.

This is a reference implementation—not a claim that replay is automatically safe for every regulated workload. Review [privacy and replay](docs/privacy-and-replay.md) before adapting it.

For a non-browser API deployment, set `SPANREPLAY_API_KEY` and send it in `x-spanreplay-api-key`. The gateway also applies a one-megabyte body limit, security headers, configurable CORS allow-list, and request rate limiting. Put public Console deployments behind your organization's OIDC or identity-aware proxy; do not embed a shared API key in frontend JavaScript.

## Datadog path

The repository includes:

- A Datadog-compatible dashboard JSON.
- Terraform-managed monitors, SLO, and dashboard.
- An optional OpenTelemetry Collector → Datadog Agent configuration.
- A stable service/tag taxonomy for cross-team adoption.

See [Datadog integration](docs/datadog-integration.md).

## Repository map

```text
src/services/                 gateway, agent, retrieval services
src/telemetry/                OTel SDK, spans, metrics, log correlation
src/replay/                   sanitized recording and deterministic replay
console/                      interactive trace and replay experience
observability/                OTel, Grafana, Prometheus, Tempo, Loki, Vector
infrastructure/kubernetes/    production-style deployment manifests
infrastructure/terraform/     Datadog dashboard, monitors, and SLO
docs/                         standards and incident response playbooks
examples/                     integration patterns for existing agents
tests/                        failure, replay, and redaction tests
```

## Engineering checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Scope and non-goals

SpanReplay is a portfolio-quality starter kit and incident lab, not a hosted observability SaaS. The simulated model keeps the project reproducible and free to run; adapters for real providers should preserve the same instrumentation and privacy boundaries.

## Contributing and security

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues according to [SECURITY.md](SECURITY.md), not in a public issue.

Apache-2.0 licensed.
