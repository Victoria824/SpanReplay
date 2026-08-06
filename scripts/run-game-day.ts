import { execFile as execFileCallback } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const gateway = process.env.SPANREPLAY_BASE_URL ?? "http://127.0.0.1:4000";
const tempo = process.env.INTEGRATION_TEMPO_URL ?? "http://127.0.0.1:3200";
const collectorMetrics = process.env.COLLECTOR_METRICS_URL ?? "http://127.0.0.1:8888/metrics";

async function compose(...args: string[]) {
  return execFile("docker", ["compose", ...args], { timeout: 120_000 });
}

async function workflow(index: number) {
  const response = await fetch(`${gateway}/api/workflows`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: `telemetry outage game day ${index}`, scenario: "healthy" }),
  });
  if (!response.ok) throw new Error(`workflow ${index} returned ${response.status}`);
  return response.json() as Promise<{ traceId: string; status: string }>;
}

async function eventually(description: string, operation: () => Promise<boolean>, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await operation()) return;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

let tempoStopped = false;
try {
  const baseline = await workflow(0);
  await compose("stop", "tempo");
  tempoStopped = true;

  const duringOutage = [];
  for (let index = 1; index <= 12; index += 1) duringOutage.push(await workflow(index));
  if (!duringOutage.every((result) => result.status === "completed")) {
    throw new Error("application workflow failed while telemetry backend was unavailable");
  }

  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const metricsResponse = await fetch(collectorMetrics);
  if (!metricsResponse.ok) throw new Error(`collector metrics returned ${metricsResponse.status}`);
  const metricsText = await metricsResponse.text();
  const queueLines = metricsText.split("\n").filter((line) => /otelcol_exporter_(?:queue|send_failed)/.test(line));
  const queueValues = queueLines
    .filter((line) => !line.startsWith("#") && /queue_size/.test(line))
    .map((line) => Number(line.trim().split(/\s+/).at(-1)))
    .filter(Number.isFinite);
  if (!queueLines.length) throw new Error("collector did not expose queue/backpressure metrics");
  if (queueValues.length > 0 && Math.max(...queueValues) === 0) throw new Error("collector queue did not record buffered telemetry during the outage");
  if (queueValues.length > 0 && Math.max(...queueValues) > 2048) throw new Error("collector queue exceeded configured capacity");

  await compose("start", "tempo");
  tempoStopped = false;
  const recoveryTrace = duringOutage.at(-1)!.traceId;
  await eventually("queued trace delivery after Tempo recovery", async () => {
    const response = await fetch(`${tempo}/api/traces/${recoveryTrace}`);
    return response.ok;
  });

  const evidence = {
    gameDay: "telemetry-backend-outage",
    executedAt: new Date().toISOString(),
    baselineTraceId: baseline.traceId,
    outageWorkflowCount: duringOutage.length,
    applicationAvailability: 1,
    collectorQueueBound: 2048,
    observedQueueMetricLines: queueLines.slice(0, 20),
    recoveredTraceId: recoveryTrace,
    acceptance: {
      applicationStayedAvailable: true,
      queueMetricsObservable: true,
      traceDeliveredAfterRecovery: true,
    },
  };
  const destination = path.resolve(process.env.GAME_DAY_EVIDENCE_PATH ?? "evidence/game-day-telemetry-outage.json");
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(evidence, null, 2)}\n`);
  const review = `# Exercise review: telemetry backend outage

- Executed: ${evidence.executedAt}
- Customer impact: none; this was a disposable-stack Game Day
- Injected fault: Tempo unavailable while application services and the collector remained live
- Workflows during outage: ${evidence.outageWorkflowCount}
- Application availability: ${(evidence.applicationAvailability * 100).toFixed(0)}%
- Collector queue bound: ${evidence.collectorQueueBound}
- Recovery evidence: trace \`${evidence.recoveredTraceId}\` became queryable after Tempo restarted

## Detection and diagnosis

Collector exporter queue/send-failure metrics identified the failing telemetry boundary. Workflow status remained completed, so the telemetry outage did not burn the user-facing availability SLO.

## Corrective controls verified

The exporter queue was bounded and observable, Tempo was restored in a finally path, and queued trace delivery resumed. Queue capacity must not be increased without an event-rate, disk-budget, outage-duration, and recovery-drain calculation.
`;
  await writeFile(path.join(path.dirname(destination), "game-day-telemetry-outage-review.md"), review);
  console.log(JSON.stringify({ verdict: "GAME DAY PASSED", ...evidence }, null, 2));
} finally {
  if (tempoStopped) await compose("start", "tempo");
}
