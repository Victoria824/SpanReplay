# Contributing

SpanReplay welcomes focused contributions that improve production AI reliability, observability, replay safety, or the five-minute developer experience.

## Development

```bash
npm install
npm run demo
npm run lint
npm run typecheck
npm test
npm run build
```

Use conventional commit prefixes where practical: `feat:`, `fix:`, `docs:`, `test:`, `chore:`.

## Design rules

1. Keep telemetry vendor-neutral at the instrumentation boundary.
2. Do not record raw prompts, retrieved content, credentials, or tool payloads by default.
3. Avoid high-cardinality metric labels. Trace IDs belong in traces and logs, not metric dimensions.
4. Every injected failure needs a deterministic test and an operator action in the incident playbook.
5. New signal names must be documented in the instrumentation standard.
6. The zero-key demo must remain useful without a model account or cloud subscription.

## Pull requests

Keep changes small enough to review. Explain the failure mode, signal, or operator workflow being improved, include tests, and attach a sanitized screenshot for Console changes.

