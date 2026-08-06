import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type ApiDocument = { data?: Array<{ attributes?: Record<string, unknown> }> };

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const apiKey = required("DD_API_KEY");
const appKey = required("DD_APP_KEY");
const site = process.env.DD_SITE ?? "datadoghq.com";
const apiBase = process.env.DD_API_URL ?? `https://api.${site}`;
const gateway = process.env.SPANREPLAY_BASE_URL ?? "http://localhost:4000";
const evidencePath = path.resolve(process.env.DD_EVIDENCE_PATH ?? "evidence/datadog-verification.json");

const headers = {
  accept: "application/json",
  "content-type": "application/json",
  "DD-API-KEY": apiKey,
  "DD-APPLICATION-KEY": appKey,
};

async function datadog(pathname: string, body: unknown): Promise<ApiDocument> {
  const response = await fetch(`${apiBase}${pathname}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Datadog ${pathname} returned ${response.status}: ${await response.text()}`);
  return await response.json() as ApiDocument;
}

async function eventually<T>(name: string, operation: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + Number(process.env.DD_VERIFY_TIMEOUT_MS ?? 240_000);
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const result = await operation();
      if (result !== null) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error(`${name} was not observable before the deadline${lastError ? `: ${String(lastError)}` : ""}`);
}

const workflowResponse = await fetch(`${gateway}/api/workflows`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ question: "exercise Datadog error correlation", scenario: "error-tracking" }),
});
if (!workflowResponse.ok) throw new Error(`Workflow trigger returned ${workflowResponse.status}`);
const workflow = await workflowResponse.json() as { traceId: string; status: string };
if (workflow.status !== "failed") throw new Error(`Expected injected failure, received ${workflow.status}`);

const trace = await eventually("cross-service trace", async () => {
  const response = await datadog("/api/v2/spans/events/search", {
    data: {
      type: "search_request",
      attributes: {
        filter: { from: "now-15m", to: "now", query: `@trace_id:${workflow.traceId}` },
        options: { timezone: "GMT" },
        page: { limit: 100 },
        sort: "timestamp",
      },
    },
  });
  const services = new Set((response.data ?? []).map((span) => String(span.attributes?.service ?? "")));
  return ["api-gateway", "agent-service", "retrieval-service"].every((service) => services.has(service))
    ? { spanCount: response.data?.length ?? 0, services: [...services].filter(Boolean).sort() }
    : null;
});

const logs = await eventually("trace-correlated logs", async () => {
  const response = await datadog("/api/v2/logs/events/search", {
    filter: { from: "now-15m", to: "now", query: `@trace_id:${workflow.traceId}` },
    page: { limit: 100 },
    sort: "timestamp",
  });
  return (response.data?.length ?? 0) > 0 ? { count: response.data?.length ?? 0 } : null;
});

const errorTracking = await eventually("Error Tracking issue", async () => {
  const now = Date.now();
  const response = await datadog("/api/v2/error-tracking/issues/search", {
    data: {
      type: "search_request",
      attributes: {
        query: "service:agent-service TypeError",
        from: now - 15 * 60_000,
        to: now + 1_000,
        track: "trace",
      },
    },
  });
  return (response.data?.length ?? 0) > 0 ? { issueCount: response.data?.length ?? 0 } : null;
});

const metricUrl = new URL(`${apiBase}/api/v1/query`);
metricUrl.searchParams.set("from", String(Math.floor(Date.now() / 1000) - 900));
metricUrl.searchParams.set("to", String(Math.floor(Date.now() / 1000)));
metricUrl.searchParams.set("query", "sum:ai.workflow.runs{platform:spanreplay}.as_count()");
const metric = await eventually("workflow metric", async () => {
  const response = await fetch(metricUrl, { headers, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Datadog metric query returned ${response.status}: ${await response.text()}`);
  const payload = await response.json() as { series?: unknown[] };
  return (payload.series?.length ?? 0) > 0 ? { seriesCount: payload.series?.length ?? 0 } : null;
});

const evidence = {
  verifiedAt: new Date().toISOString(),
  environment: process.env.DD_ENV ?? "local",
  traceId: workflow.traceId,
  trace,
  logs,
  metric,
  errorTracking,
};
await mkdir(path.dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ verdict: "DATADOG VERIFIED", ...evidence }, null, 2));
