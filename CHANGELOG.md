# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/) and semantic versioning.

## [Unreleased]

### Changed

- Replaced result cloning with full agent state-machine replay backed by recorded retrieval, model, and tool adapters.
- Added prompt, configuration, and registered code-version selection with explicit drift dimensions.
- Added Tempo, Prometheus, and Loki correlation verification to the full-stack CI path.
- Clarified that the tool boundary is simulated and corrected the Console's single-trace latency label.

### Added

- Reusable Node observability SDK with correlated logging, Error Tracking normalization, metric-cardinality enforcement, and service-manifest validation.
- Datadog Agent Compose overlay, log pipeline, Error Tracking/load-shedding monitors, protected verification workflow, and API-level evidence collector.
- Measured retrieval saturation experiment showing the single-instance queueing knee, four-instance comparison, and explicit 429 load shedding.
- Auth0 RS256/JWKS verification, tenant isolation, hierarchical replay roles, live-replay reason requirement, and audit events.
- Independent orders-service onboarding example and CI conformance gates for four service manifests.
- Disk-backed collector queues, telemetry-backend outage Game Day automation, Prometheus alert rules, and incident review template.
- S3/KMS replay repository, IRSA/ECR Terraform, Kubernetes HA overlay, and protected AWS plan/apply/deploy workflow with remote state.

## [0.1.0] - 2026-08-04

### Added

- Node.js/TypeScript gateway, agent, retrieval, and simulated tool workflow.
- OpenTelemetry traces and AI-specific metrics with Pino trace-correlated logs.
- Seven controlled failure scenarios and privacy-aware fixture/live replay APIs.
- Interactive zero-key Replay Console.
- Grafana, Tempo, Prometheus, Loki, and Vector Compose stack.
- Datadog Collector path, dashboard, monitors, SLO, and Terraform module.
- Kubernetes deployment, CI, CodeQL, tests, incident playbooks, and instrumentation standards.
- QueryAssure instrumentation example.

[Unreleased]: https://github.com/Victoria824/SpanReplay/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Victoria824/SpanReplay/releases/tag/v0.1.0
