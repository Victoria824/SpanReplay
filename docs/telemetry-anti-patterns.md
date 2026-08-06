# Telemetry anti-pattern review

| Anti-pattern | Operational cost | SpanReplay guardrail |
| --- | --- | --- |
| Trace ID, user ID, URL, prompt, or error message on metrics | Cardinality and cost explosion | Executable metric attribute allow-list rejects unapproved and known high-cardinality keys |
| Logging raw prompts or tool arguments | Privacy/security incident | Content is redacted by default; logger and error normalizer redact common secrets and email addresses |
| One span per token or retrieved chunk | Unusable traces and ingestion volume | Spans represent workflow and dependency operations; token/chunk totals are attributes or metrics |
| Retrying every provider failure | Retry storm and higher cost | One bounded retry, explicit fallback, measured attempt path |
| Alerting on a single exception | Noise and alert fatigue | SLO/sustained monitors page; Error Tracking monitor is reserved for genuinely new issue groups |
| Sampling away errors | Missing incident evidence | Sampling policy retains errors, policy blocks, and replay traces |
| Treating a policy block as availability failure | False SLO burn | Workflow status separates `blocked` from `failed` |
| Assuming telemetry delivery is lossless | Collector OOM or silent loss | Production collector has memory limits, bounded disk queue, retries, and its own metrics |
| Sharing a ReadWriteOnce replay volume across replicas | Failed scheduling or inconsistent HA | Production gateway uses encrypted S3 through IRSA |
| Overwriting account-wide Datadog pipeline order | Breaks unrelated teams' logs | Terraform exports the pipeline ID; the account owner merges order explicitly |

Review this table during design and incident retrospectives. A justified exception should be recorded as an ADR with an owner and expiry date.
