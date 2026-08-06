# ADR 002: Replay evidence is a versioned data product

- Status: accepted
- Decision date: 2026-08-04

## Context

Re-running only an HTTP request does not reproduce an agent workflow because retrieval, model, and tool responses may have changed. Retaining all raw context would improve fidelity but creates unacceptable privacy and safety risk.

## Decision

Fixture replay records versioned adapter inputs/outcomes, sanitizes them, and re-executes the complete state machine. Prompt, configuration, and code versions are explicit comparison dimensions. Live replay is refused for redacted records. Local development uses an atomic owner-only filesystem repository; production uses encrypted/versioned S3 with IRSA and retention controls.

## Consequences

Incidents become deterministic regression cases and intentional threshold/tool mutations must report `DRIFT DETECTED`. Exact model text is unavailable when content redaction is enabled, and schema migrations need compatibility tests. Destructive tools remain outside live replay unless separately approved and idempotent.
