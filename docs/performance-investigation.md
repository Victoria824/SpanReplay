# Retrieval saturation investigation

## Question

Can retrieval scale horizontally once per-instance concurrency crosses the deliberately injected queueing knee of four requests, and can the telemetry distinguish queueing from correctness failures?

## Reproducible method

`npm run experiment:performance` drives 4, 8, 16, and 32 concurrent requests through the same Fastify retrieval implementation. The baseline sends all work to one instance; the candidate distributes the same work round-robin across four independent instances. Five rounds produce 20–160 samples per point. Both profiles use a 5 ms service delay and 20 ms queue penalty above concurrency four.

The experiment fails unless every request succeeds and the four-instance p95 at concurrency 32 is at least 40% lower. Raw, timestamped measurements are written to `evidence/performance-experiment.json`; k6 remains the network-level smoke and sustained-load driver.

## Interpretation

The experiment isolates the service-concurrency bottleneck: horizontal partitioning should move the queueing knee from four total requests to roughly four per replica. It does not claim AWS/EKS capacity because `Fastify.inject` removes network, ingress, CPU throttling, and node scheduling. Those variables must be measured after deployment using the same concurrency matrix.

Scaling only on average CPU is insufficient for an I/O-heavy retriever. Production should export an active/queued request gauge and drive an external-metric HPA or load-shedding threshold from the validated safe concurrency per pod. Roll back if error rate rises, collector drops appear, or p95 exceeds the service objective after the scale event.

## Recorded local result

The 2026-08-06 local run completed with zero errors at every point:

| Replicas | Concurrency | Throughput req/s | p50 ms | p95 ms | p99 ms |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 4 | 413.0 | 6.8 | 14.8 | 19.8 |
| 1 | 8 | 91.7 | 7.6 | 86.6 | 87.8 |
| 1 | 16 | 64.2 | 91.6 | 246.6 | 248.3 |
| 1 | 32 | 56.0 | 249.6 | 547.4 | 567.6 |
| 4 | 4 | 578.1 | 5.9 | 9.8 | 9.8 |
| 4 | 8 | 1080.3 | 6.4 | 9.8 | 9.9 |
| 4 | 16 | 1971.6 | 6.0 | 12.0 | 12.2 |
| 4 | 32 | 359.7 | 10.5 | 87.0 | 89.8 |

At concurrency 32, four instances reduced p95 by 84.1% and increased measured throughput by 542.3%. Because this is an in-process controlled experiment, the percentages establish the queueing mechanism and regression gate; they are not presented as production capacity claims. The service now also supports a configured concurrency ceiling, returns `429` plus `Retry-After` when full, and counts admitted versus shed work.
