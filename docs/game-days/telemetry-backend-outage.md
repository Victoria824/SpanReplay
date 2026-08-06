# Game day: telemetry backend outage

## Scenario

Tempo is stopped while the gateway, agent, retrieval service, and OpenTelemetry Collector remain live. Twelve healthy workflows run during the outage. The exercise is successful only if application availability remains 100%, collector queue/backpressure metrics are observable and within the configured 2,048-item bound, and the final queued trace becomes queryable after Tempo restarts.

Run this only against the disposable local Compose stack:

```bash
npm run game-day:telemetry-outage
```

The script restores Tempo in `finally` even when an assertion fails and writes timestamped evidence to `evidence/game-day-telemetry-outage.json` only after recovery is proven. CI uploads the evidence artifact.

## Expected diagnosis

The first failing component is the collector exporter, not the application. Application latency and status should remain stable; exporter queue size and send-failure/retry metrics should rise. A full queue means telemetry loss is intentional and bounded rather than an application OOM. The five-minute retry budget is a local exercise value; production uses ten minutes and disk-backed per-pod storage.

## Follow-up decision

Do not increase queue size without measuring outage duration, event rate, disk budget, and recovery drain time. Alert before capacity exhaustion, document expected data loss after the retry budget, and keep backend availability out of the user-facing workflow SLO.
