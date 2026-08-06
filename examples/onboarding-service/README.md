# Independent service onboarding example

This intentionally small service is owned by a fictional commerce team and imports only the public `@spanreplay/observability-sdk` surface. It demonstrates that resource identity, OTLP export, correlated logging, and shutdown handling do not depend on SpanReplay service internals.

Its `observability.manifest.json` is evaluated by the same CI conformance gate as platform services. Change the metric attribute to `customer_id`, remove the owner, or omit an Error Tracking field and `npm run check:instrumentation` will fail with the responsible contract.
