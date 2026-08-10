# Service onboarding: the paved road

The goal is a useful first trace in one pull request, not a new bespoke telemetry framework per team. The reusable package in `packages/observability-sdk` owns resource identity, OTLP export, trace-correlated JSON logging, error normalization, redaction, and metric-cardinality enforcement.

## Adoption sequence

1. Name the deployable service, owner, environment, and version using the tagging taxonomy.
2. Call `initializeNodeObservability` before importing the web framework or application modules.
3. Replace the application logger with `createCorrelatedLogger`; keep raw prompts, documents, credentials, and customer identifiers out of logs.
4. Instrument one user-visible workflow and its dependency boundaries. Record exceptions on the smallest responsible span.
5. Register every metric and its allowed dimensions in a policy reviewed by the platform owner.
6. Run a healthy request and a controlled failure. Prove the trace crosses services, the metric is queryable, and the log pivots by trace ID.
7. Define an SLO and a runbook before enabling paging. Start with dashboard-only evaluation during a one-week calibration period.
8. Add a deterministic replay fixture or contract test for each failure mode the service owns.

## Pull-request evidence

- Screenshot or query showing the service in a distributed trace.
- One correlated structured log with no content or secrets.
- Metric names and bounded dimensions.
- Error Tracking fields for an injected exception.
- SLO owner, alert destination, rollback signal, and runbook link.
- Estimated healthy-traffic telemetry volume and sampling choice.

## Promotion gates

Staging must pass `npm run test:observability`, the fixture replay drift tests, and a k6 smoke run. Production promotion is blocked when a new metric dimension is unregistered, a replay can invoke an irreversible live tool, or the service has no owner/recovery condition. The platform team supplies the SDK and examples; service teams retain responsibility for workflow semantics and SLOs.
