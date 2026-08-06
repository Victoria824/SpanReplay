# Privacy-aware replay

Agent traces are valuable because they contain context; that same context can contain personal data, credentials, proprietary documents, or destructive tool arguments. SpanReplay therefore treats replay as a separate data product with a stricter contract than ordinary traces.

## Default policy

- Raw workflow questions are not retained.
- Secret-like keys, API tokens, bearer strings, and email addresses are redacted recursively.
- Retrieved document bodies are excluded; fixtures store bounded identifiers, titles, and relevance only.
- Replay records use a versioned schema, owner-only permissions, atomic writes, and strict trace IDs.
- Live replay is refused when content was redacted.
- Fixture replay re-executes the agent state machine through recorded adapter outcomes and performs no external provider or tool calls.

## Before production use

The included S3 repository and AWS Terraform module provide KMS encryption, versioning, lifecycle expiry, and IRSA for a single approved environment. Before production use, additionally add tenant-level authorization, access audit events, legal/privacy review, deletion workflows (including versioned objects), regional controls, and per-tool replay policies.

## Threats explicitly considered

- Path traversal through trace IDs.
- Secret leakage through logs, attributes, exception messages, and replay files.
- Re-execution of destructive or non-idempotent tools.
- Cross-tenant replay access.
- Prompt injection embedded in retained documents.
- Replay drift caused by model/provider/config changes.

The starter kit addresses the first three in its demo boundary and documents the remaining controls rather than presenting them as solved.
