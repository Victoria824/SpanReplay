# Blameless observability incident review

## Summary and customer impact

State what users experienced, affected environments/tenants, start/end time, and measurable availability/latency impact. Separate policy-blocked workflows from failed workflows.

## Timeline

Use UTC timestamps for first symptom, detection, declaration, mitigation, recovery, and validation. Link trace IDs and monitor events; do not attach raw prompts, credentials, or customer content.

## Detection and telemetry gaps

- Which signal detected the incident first?
- Which service contained the first failing or slow span?
- Was log/trace correlation available?
- Were error grouping, tags, and SLO classification correct?
- Did sampling, pipeline processing, or backend failure hide evidence?

## Root cause and contributing conditions

Describe the system condition and why defenses did not prevent impact. Avoid individual blame. Distinguish trigger, root cause, and factors that increased duration or blast radius.

## Replay and experimental evidence

Record the fixture schema, prompt/config/code versions, replay mode, mutations, and whether `DRIFT DETECTED` matched the expected behavior. For capacity incidents include concurrency, throughput, p50/p95/p99, error rate, pod/resource limits, and collector queue utilization.

## Actions

Every action needs an owner, due date, verification method, and category: prevent, detect, mitigate, or learn. “Add monitoring” is not an acceptable action without a signal contract, threshold rationale, runbook, and recovery condition.
