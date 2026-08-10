# Performance and saturation lab

The lab separates end-to-end capacity from a deliberately queueing retrieval dependency.
It is designed to answer *which service owns the critical path*, not only whether latency rose.

```bash
docker compose up --detach --build
docker run --rm --network host \
  -v "$PWD/performance:/scripts:ro" grafana/k6:0.54.0 \
  run /scripts/workflow-load.js

docker run --rm --network host \
  -v "$PWD/performance:/scripts:ro" grafana/k6:0.54.0 \
  run /scripts/retrieval-saturation.js
```

During the saturation experiment, compare:

1. `ai.workflow.duration` with retrieval span duration.
2. `ai.retrieval.concurrency` against retrieval p95.
3. Collector queue and dropped-span metrics before attributing missing traces to the app.
4. Service CPU and event-loop delay before scaling replicas.

The injected queue begins after four concurrent retrievals. This creates an observable knee in
the latency curve without relying on an external provider. CI runs a short smoke profile; the
long profile is intended for repeatable capacity reviews and incident exercises.
