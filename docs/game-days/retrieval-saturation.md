# Game day: retrieval saturation and telemetry backpressure

This is a controlled experiment, not a claim about production capacity.

## Hypothesis

Once retrieval concurrency exceeds four requests, queue delay becomes visible in retrieval latency while correctness remains intact. The system should expose concurrency and latency without generating unbounded telemetry memory use.

## Procedure and acceptance criteria

1. Run `npm test -- tests/retrieval-saturation.test.ts` for a deterministic eight-request boundary test.
2. Start the full stack and run `docker run --rm --network host -e SMOKE=true -v "$PWD/performance:/scripts:ro" grafana/k6:0.54.0 run /scripts/retrieval-saturation.js`.
3. Confirm error rate below 1%, p95 below 1.2 seconds, and `ai.retrieval.concurrency` is tagged only with the bounded mode.
4. In production overlay testing, interrupt the OTLP backend and confirm collector queue growth is bounded, retries stop after ten minutes, application responses remain healthy, and collector memory stays below its limit.

## Expected interpretation

The unit experiment asserts the queueing knee without depending on wall-clock throughput. k6 supplies a repeatable smoke envelope, not a final capacity number. If p95 rises before concurrency four, inspect CPU/network and downstream limits; if errors rise after four, tune load shedding or scale on a queue/concurrency external metric rather than blindly raising timeouts.

## Rollback and follow-up

Remove the injected `retrieval-saturation` scenario from traffic, restore the previous collector configuration, and verify queue depth returns to zero. Record tested image versions, node sizes, p50/p95/p99, error rate, collector queue utilization, and the chosen safe operating limit in the deployment change.
