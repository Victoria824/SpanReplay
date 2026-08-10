# Evidence policy

Evidence is generated only by an executable assertion path; screenshots or success files are not fabricated.

- `performance-experiment.json` is a completed local controlled experiment. It records parameters, raw percentile/throughput results, and acceptance booleans.
- `datadog-verification.json` appears only after the verifier observes the cross-service trace, correlated logs, workflow metric, and Error Tracking issues through Datadog APIs. The checked-in result was produced by [workflow run #31409061260](https://github.com/Victoria824/SpanReplay/actions/runs/31409061260); the run artifact records the same JSON with its GitHub-generated digest.
- `game-day-telemetry-outage.json` and its exercise review appear only after Tempo is stopped, application availability and queue bounds are checked, and a queued trace is observed after recovery.

External evidence may contain organization identifiers or trace IDs. CI artifacts are retained for 30 days; review them before sharing publicly and never add API keys, access tokens, raw prompts, or customer content.
