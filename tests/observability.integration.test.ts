import { describe, expect, it } from "vitest";

const enabled = process.env.RUN_OBSERVABILITY_INTEGRATION === "true";
const gatewayUrl = process.env.INTEGRATION_GATEWAY_URL ?? "http://127.0.0.1:4000";
const tempoUrl = process.env.INTEGRATION_TEMPO_URL ?? "http://127.0.0.1:3200";
const prometheusUrl = process.env.INTEGRATION_PROMETHEUS_URL ?? "http://127.0.0.1:9090";
const lokiUrl = process.env.INTEGRATION_LOKI_URL ?? "http://127.0.0.1:3100";

async function eventually<T>(
  description: string,
  operation: () => Promise<T | undefined>,
  timeoutMs = 45_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await operation();
      if (value !== undefined) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(
    `Timed out waiting for ${description}${lastError instanceof Error ? `: ${lastError.message}` : ""}`,
  );
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

describe.skipIf(!enabled)("observability stack", () => {
  it("correlates one workflow across Tempo, Prometheus, and Loki", async () => {
    const workflowResponse = await fetch(`${gatewayUrl}/api/workflows`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: "How should we respond to a provider timeout?",
        scenario: "healthy",
      }),
    });
    expect(workflowResponse.ok).toBe(true);
    const workflow = await workflowResponse.json() as { traceId: string; status: string };
    expect(workflow.status).toBe("completed");
    expect(workflow.traceId).toMatch(/^[a-f0-9]{32}$/);

    const tempoTrace = await eventually("Tempo trace ingestion", async () => {
      const response = await fetch(`${tempoUrl}/api/traces/${workflow.traceId}`);
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(`Tempo returned ${response.status}`);
      return response.json();
    });
    const traceJson = JSON.stringify(tempoTrace);
    expect(traceJson).toContain("api-gateway");
    expect(traceJson).toContain("agent-service");
    expect(traceJson).toContain("retrieval-service");

    const prometheusResult = await eventually("Prometheus workflow metric", async () => {
      const query = encodeURIComponent("sum(spanreplay_ai_workflow_runs_total)");
      const body = await fetchJson(`${prometheusUrl}/api/v1/query?query=${query}`) as {
        data?: { result?: unknown[] };
      };
      return body.data?.result?.length ? body : undefined;
    });
    expect((prometheusResult as { data: { result: unknown[] } }).data.result.length).toBeGreaterThan(0);

    const lokiResult = await eventually("Loki trace-correlated log", async () => {
      const params = new URLSearchParams({
        query: `{platform="spanreplay"} |= "${workflow.traceId}"`,
        limit: "20",
        start: String(BigInt(Date.now() - 60_000) * 1_000_000n),
        end: String(BigInt(Date.now() + 1_000) * 1_000_000n),
      });
      const body = await fetchJson(`${lokiUrl}/loki/api/v1/query_range?${params}`) as {
        data?: { result?: unknown[] };
      };
      return body.data?.result?.length ? body : undefined;
    });
    expect(JSON.stringify(lokiResult)).toContain(workflow.traceId);

    const replayResponse = await fetch(`${gatewayUrl}/api/replays/${workflow.traceId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "fixture", reason: "observability integration check" }),
    });
    expect(replayResponse.ok).toBe(true);
    const replay = await replayResponse.json() as { driftDetected: boolean; replayTraceId: string };
    expect(replay.driftDetected).toBe(false);

    const replayAudit = await eventually("Loki replay audit event", async () => {
      const params = new URLSearchParams({
        query: `{platform="spanreplay"} |= "replay.executed" |= "${workflow.traceId}"`,
        limit: "20",
        start: String(BigInt(Date.now() - 60_000) * 1_000_000n),
        end: String(BigInt(Date.now() + 1_000) * 1_000_000n),
      });
      const body = await fetchJson(`${lokiUrl}/loki/api/v1/query_range?${params}`) as {
        data?: { result?: unknown[] };
      };
      return body.data?.result?.length ? body : undefined;
    });
    expect(JSON.stringify(replayAudit)).toContain(workflow.traceId);
  });
});
