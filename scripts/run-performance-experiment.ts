import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildRetrievalServer } from "../src/services/retrieval/server.js";

type Measurement = {
  replicas: number;
  concurrency: number;
  requests: number;
  throughputRps: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  errorRate: number;
};

const percentile = (sorted: number[], value: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)] ?? 0;

async function measure(replicas: number, concurrency: number, rounds: number): Promise<Measurement> {
  const servers = Array.from({ length: replicas }, () => buildRetrievalServer());
  const durations: number[] = [];
  let errors = 0;
  const started = performance.now();

  for (let round = 0; round < rounds; round += 1) {
    const responses = await Promise.all(Array.from({ length: concurrency }, (_, index) => {
      const server = servers[index % servers.length];
      if (!server) throw new Error("Retrieval server pool is empty");
      const requestStarted = performance.now();
      return server.inject({
        method: "POST",
        url: "/retrieve",
        payload: { query: "provider timeout", scenario: "retrieval-saturation" },
      }).then((response) => {
        durations.push(performance.now() - requestStarted);
        if (response.statusCode !== 200) errors += 1;
      });
    }));
    void responses;
  }

  const elapsedMs = performance.now() - started;
  await Promise.all(servers.map((server) => server.close()));
  durations.sort((a, b) => a - b);
  return {
    replicas,
    concurrency,
    requests: durations.length,
    throughputRps: Number((durations.length / (elapsedMs / 1_000)).toFixed(1)),
    p50Ms: Number(percentile(durations, 0.5).toFixed(1)),
    p95Ms: Number(percentile(durations, 0.95).toFixed(1)),
    p99Ms: Number(percentile(durations, 0.99).toFixed(1)),
    errorRate: Number((errors / durations.length).toFixed(4)),
  };
}

process.env.SATURATION_BASE_DELAY_MS ??= "5";
process.env.SATURATION_QUEUE_DELAY_MS ??= "20";
process.env.LOG_LEVEL ??= "silent";

const concurrencyLevels = [4, 8, 16, 32];
const rounds = Number(process.env.PERFORMANCE_ROUNDS ?? 5);
const baseline: Measurement[] = [];
const scaled: Measurement[] = [];
for (const concurrency of concurrencyLevels) {
  baseline.push(await measure(1, concurrency, rounds));
  scaled.push(await measure(4, concurrency, rounds));
}

const baselinePeak = baseline.at(-1)!;
const scaledPeak = scaled.at(-1)!;
const p95ImprovementPercent = Number(
  ((baselinePeak.p95Ms - scaledPeak.p95Ms) / baselinePeak.p95Ms * 100).toFixed(1),
);
const throughputImprovementPercent = Number(
  ((scaledPeak.throughputRps - baselinePeak.throughputRps) / baselinePeak.throughputRps * 100).toFixed(1),
);
const evidence = {
  experiment: "retrieval-horizontal-scaling",
  measuredAt: new Date().toISOString(),
  parameters: {
    rounds,
    saturationBaseDelayMs: Number(process.env.SATURATION_BASE_DELAY_MS),
    saturationQueueDelayMs: Number(process.env.SATURATION_QUEUE_DELAY_MS),
  },
  baseline,
  scaled,
  peakComparison: { concurrency: 32, p95ImprovementPercent, throughputImprovementPercent },
  acceptance: {
    noErrors: [...baseline, ...scaled].every((measurement) => measurement.errorRate === 0),
    scaledP95AtLeast40PercentLower: scaledPeak.p95Ms <= baselinePeak.p95Ms * 0.6,
  },
};
if (!Object.values(evidence.acceptance).every(Boolean)) {
  throw new Error(`Performance acceptance failed: ${JSON.stringify(evidence.acceptance)}`);
}

const destination = path.resolve(process.env.PERFORMANCE_EVIDENCE_PATH ?? "evidence/performance-experiment.json");
await mkdir(path.dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(evidence, null, 2)}\n`);
console.table([...baseline, ...scaled]);
console.log(JSON.stringify({ verdict: "PERFORMANCE IMPROVEMENT VERIFIED", ...evidence.peakComparison }, null, 2));
