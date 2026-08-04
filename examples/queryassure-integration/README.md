# QueryAssure integration example

QueryAssure can keep its own product and evaluation model while emitting standardized production signals through SpanReplay's instrumentation pattern.

Wrap each SQL-agent evaluation with `instrumentQueryAssureEvaluation`. The span captures evaluation identity, bounded outcomes, duration, provider/model, prompt version, and a hash of the test case—never the natural-language question or generated SQL. The same run contributes low-cardinality pass/fail and latency metrics.

This integration keeps the repositories independent:

- QueryAssure owns SQL-agent validation, benchmark cases, and its chat experience.
- SpanReplay owns cross-service traces, operations metrics, incident response, and failure replay patterns.
- OpenTelemetry is the stable contract between them.

For failed evaluations, store the QueryAssure case identifier and validator reasons in the QueryAssure system. Pass only bounded reason codes into telemetry; link richer sanitized evidence by trace ID.

