import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ReplayStore } from "../src/replay/store.js";
import { buildGatewayServer } from "../src/services/gateway/server.js";
import { buildRetrievalServer } from "../src/services/retrieval/server.js";
import { createRuntimeAdapters } from "../src/adapters/runtime.js";
import { runRecordedAgent } from "../src/services/agent/server.js";

const replayDirectory = await mkdtemp(path.join(tmpdir(), "spanreplay-demo-"));
const retrieval = buildRetrievalServer();
const runtimeAdapters = createRuntimeAdapters();
const gateway = buildGatewayServer(
  new ReplayStore(replayDirectory),
  (input) =>
    runRecordedAgent(input, {
      ...runtimeAdapters,
      retrieval: {
        async retrieve({ query, scenario }) {
          const response = await retrieval.inject({
            method: "POST",
            url: "/retrieve",
            payload: { query, scenario },
          });
          if (response.statusCode !== 200) throw new Error(`retrieval returned ${response.statusCode}`);
          return response.json();
        },
      },
    }),
);

const scenarios = ["healthy", "irrelevant-context", "tool-error", "cost-spike"] as const;
const rows: Array<Record<string, string | number>> = [];
let replayTraceId = "";
let baselineTraceId = "";

for (const scenario of scenarios) {
  const response = await gateway.inject({
    method: "POST",
    url: "/api/workflows",
    payload: {
      question: "How should we respond when the primary LLM provider times out?",
      scenario,
    },
  });
  const result = response.json();
  if (scenario === "healthy") baselineTraceId = result.traceId;
  if (scenario === "tool-error") replayTraceId = result.traceId;
  rows.push({
    scenario,
    status: result.status,
    trace: result.traceId.slice(0, 12),
    score: result.evaluation.score,
    cost_usd: result.usage.estimatedCostUsd,
  });
}

const replayResponse = await gateway.inject({
  method: "POST",
  url: `/api/replays/${replayTraceId}`,
  payload: { mode: "fixture" },
});
const replay = replayResponse.json();
const driftResponse = await gateway.inject({
  method: "POST",
  url: `/api/replays/${baselineTraceId}`,
  payload: {
    mode: "fixture",
    promptVersion: "support-agent-v2",
    configVersion: "strict-v2",
    codeVersion: "current",
  },
});
const drift = driftResponse.json();

console.log("\nSpanReplay deterministic incident lab\n");
console.table(rows);
console.log(
  JSON.stringify(
    {
      replay: {
        mode: replay.mode,
        original_trace_id: replay.originalTraceId,
        replay_trace_id: replay.replayTraceId,
        drift_detected: replay.driftDetected,
        changed: replay.changed,
      },
      candidate_replay: {
        verdict: drift.driftDetected ? "DRIFT DETECTED" : "REPRODUCED",
        original_trace_id: drift.originalTraceId,
        replay_trace_id: drift.replayTraceId,
        changed: drift.changed,
      },
      privacy: {
        raw_question_retained: false,
        replay_directory: replayDirectory,
      },
    },
    null,
    2,
  ),
);

await Promise.all([gateway.close(), retrieval.close()]);
