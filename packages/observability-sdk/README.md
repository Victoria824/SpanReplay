# @spanreplay/observability-sdk

Reusable Node.js observability bootstrap used by every SpanReplay service. It standardizes
OpenTelemetry resource attributes, OTLP exporters, trace-correlated Pino logging, secret
redaction, and enforceable metric-cardinality policy.

```ts
import {
  createCorrelatedLogger,
  initializeNodeObservability,
} from "@spanreplay/observability-sdk";

const logger = createCorrelatedLogger({
  serviceName: "billing-service",
  environment: "production",
});

const observability = await initializeNodeObservability({
  serviceName: "billing-service",
  serviceVersion: "2026.08.04",
  environment: "production",
  namespace: "payments",
  instanceId: process.env.HOSTNAME ?? "local",
  otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});
```

The package intentionally owns platform defaults, not application-specific metric names or
business spans. Teams keep those in their service while consuming the same resource, logging,
redaction, and cardinality contracts.
