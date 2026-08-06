# Production AI incident playbook

## First five minutes

1. Confirm user impact, environment, release version, and whether a policy block is being misclassified as a failure.
2. Open the workflow-outcome dashboard and compare error rate, p95 latency, estimated cost, validation failures, and tool success.
3. Pivot from a structured log `trace_id` to the distributed trace.
4. Identify the first failing or slow span; do not assume the model is the cause.
5. Preserve sanitized evidence, choose fixture replay, and record mitigation plus rollback owner.

## Failure matrix

| Signal | Likely cause | Confirm | Mitigate | Prevent |
| --- | --- | --- | --- | --- |
| Retrieval p95 spike | vector store/network saturation | retrieval span vs overall latency | timeout, cache, shed load | capacity test and dependency SLO |
| Relevance drops | index/schema/content change | relevance histogram and document IDs | block ungrounded answer, restore index | golden retrieval cases and canary |
| Provider timeout | provider/network/regional issue | provider span status and latency | one jittered retry, fallback model | circuit breaker and provider budget |
| Tool failures | downstream API contract/outage | tool span, status, attempts | stop irreversible path, retry safe calls | contract tests and idempotency |
| Validation failures | prompt/model/policy drift | prompt version and bounded reason | keep block, roll back prompt/model | regression gate before promotion |
| Cost spike | loops, retries, larger context/model | tokens, step count, prompt version | cap steps/tokens, switch model | per-workflow budget and release comparison |

## Replay decision

Use **fixture replay** for first response. It re-executes the agent state machine through sanitized recorded adapter outcomes and cannot call real providers or tools. Use **live replay** only in an isolated non-sensitive environment, after confirming the record retained content intentionally and tool operations are safe/idempotent.

## Root-cause write-up

Document timeline, impact, detection gap, first failing span, contributing conditions, mitigation, why safeguards did or did not activate, and dated owners for prevention. Attach trace IDs and dashboard links; never attach raw secrets or customer content.
