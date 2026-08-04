import { timingSafeEqual } from "node:crypto";

import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";

import {
  WorkflowRequestSchema,
  type ReplayComparison,
  type ReplayRecord,
  type RetrievedDocument,
  type WorkflowResult,
} from "../../contracts.js";
import { ReplayStore } from "../../replay/store.js";
import { logger } from "../../telemetry/logger.js";
import { activeTraceId, inSpan, telemetry } from "../../telemetry/signals.js";

const agentUrl = () => process.env.AGENT_SERVICE_URL ?? "http://localhost:4001";

function publicResult(payload: WorkflowResult & { retrievedDocuments?: RetrievedDocument[] }): WorkflowResult {
  const result = { ...payload };
  delete result.retrievedDocuments;
  return result;
}

function compare(
  record: ReplayRecord,
  replay: WorkflowResult,
  mode: "fixture" | "live",
): ReplayComparison {
  const originalPath = record.result.steps.map((step) => step.name).join("|");
  const replayPath = replay.steps.map((step) => step.name).join("|");
  return {
    originalTraceId: record.originalTraceId,
    replayTraceId: replay.traceId,
    mode,
    changed: {
      status: record.result.status !== replay.status,
      answer: record.result.answer !== replay.answer,
      toolPath: originalPath !== replayPath,
      validation:
        record.result.evaluation.validationPassed !== replay.evaluation.validationPassed,
    },
    original: record.result,
    replay,
  };
}

async function callAgent(body: unknown): Promise<WorkflowResult & { retrievedDocuments: RetrievedDocument[] }> {
  const response = await fetch(`${agentUrl()}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Number(process.env.AGENT_TIMEOUT_MS ?? 6_000)),
  });
  if (!response.ok) throw new Error(`agent service returned ${response.status}`);
  return (await response.json()) as WorkflowResult & { retrievedDocuments: RetrievedDocument[] };
}

type ExecuteAgent = typeof callAgent;

function hasValidApiKey(candidate: string | string[] | undefined): boolean {
  const expected = process.env.SPANREPLAY_API_KEY;
  if (!expected) return true;
  if (typeof candidate !== "string") return false;
  const expectedBuffer = Buffer.from(expected);
  const candidateBuffer = Buffer.from(candidate);
  return expectedBuffer.length === candidateBuffer.length && timingSafeEqual(expectedBuffer, candidateBuffer);
}

async function fixtureReplay(record: ReplayRecord): Promise<WorkflowResult> {
  return inSpan(
    "replay_workflow fixture",
    {
      "ai.replay.mode": "fixture",
      "ai.replay.original_trace_id": record.originalTraceId,
      "failure.scenario": record.request.scenario,
    },
    async () => {
      for (const step of record.result.steps) {
        await inSpan(
          `replay_step ${step.name}`,
          {
            "ai.replay.original_service": step.service,
            "ai.replay.original_status": step.status,
          },
          async () => undefined,
        );
      }
      return {
        ...structuredClone(record.result),
        traceId: activeTraceId(),
        metadata: { ...record.result.metadata, replayOf: record.originalTraceId },
      };
    },
  );
}

export function buildGatewayServer(
  store = new ReplayStore(),
  executeAgent: ExecuteAgent = callAgent,
) {
  const app = Fastify({ loggerInstance: logger, bodyLimit: 1_048_576 });
  const configuredOrigins = (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  void app.register(helmet, { contentSecurityPolicy: false });
  void app.register(rateLimit, {
    max: Number(process.env.RATE_LIMIT_MAX ?? 120),
    timeWindow: "1 minute",
  });
  void app.register(cors, {
    origin: configuredOrigins.length > 0
      ? configuredOrigins
      : [/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/],
    methods: ["GET", "POST"],
  });

  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/") || hasValidApiKey(request.headers["x-spanreplay-api-key"])) return;
    return reply.code(401).send({ error: "A valid x-spanreplay-api-key header is required" });
  });

  app.get("/health", async () => ({ status: "ok", service: "api-gateway" }));
  app.get("/ready", async (_request, reply) => {
    try {
      const response = await fetch(`${agentUrl()}/health`, { signal: AbortSignal.timeout(750) });
      if (!response.ok) throw new Error(`agent health returned ${response.status}`);
      return { status: "ready", service: "api-gateway" };
    } catch {
      return reply.code(503).send({ status: "not-ready", dependency: "agent-service" });
    }
  });

  app.post("/api/workflows", async (request, reply) => {
    const parsed = WorkflowRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const execution = await inSpan(
      "spanreplay.workflow",
      {
        "gen_ai.operation.name": "invoke_agent",
        "gen_ai.agent.name": "incident-assistant",
        "failure.scenario": parsed.data.scenario,
        "ai.prompt.version": parsed.data.promptVersion,
      },
      () => executeAgent(parsed.data),
    );
    const result = publicResult(execution);
    await store.save(parsed.data, result, execution.retrievedDocuments ?? []);
    return reply.code(200).send(result);
  });

  app.get("/api/replays", async (request) => {
    const query = request.query as { limit?: string };
    const requestedLimit = Number(query.limit ?? 25);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 100)
      : 25;
    const records = await store.list(limit);
    return records.map((record) => ({
      traceId: record.originalTraceId,
      recordedAt: record.recordedAt,
      status: record.result.status,
      scenario: record.request.scenario,
      failure: record.result.failure,
      privacy: record.privacy,
    }));
  });

  app.get("/api/replays/:traceId", async (request, reply) => {
    try {
      return await store.get((request.params as { traceId: string }).traceId);
    } catch {
      return reply.code(404).send({ error: "Replay record not found" });
    }
  });

  app.post("/api/replays/:traceId", async (request, reply) => {
    const traceId = (request.params as { traceId: string }).traceId;
    const mode = ((request.body as { mode?: string } | undefined)?.mode ?? "fixture") as
      | "fixture"
      | "live";
    if (!(["fixture", "live"] as const).includes(mode)) {
      return reply.code(400).send({ error: "mode must be fixture or live" });
    }

    let record: ReplayRecord;
    try {
      record = await store.get(traceId);
    } catch {
      return reply.code(404).send({ error: "Replay record not found" });
    }

    if (mode === "live" && record.privacy.contentRedacted) {
      return reply.code(409).send({
        error: "Live replay is unavailable because raw request content was not retained",
        hint: "Use fixture replay, or explicitly set SPANREPLAY_REDACT_CONTENT=false in a non-sensitive demo environment.",
      });
    }

    const replay =
      mode === "fixture"
        ? await fixtureReplay(record)
        : publicResult(
            await executeAgent({
              ...record.request,
              replayOf: record.originalTraceId,
            }),
          );
    const outcome = compare(record, replay, mode);
    telemetry.replay(mode, replay.status);
    return outcome;
  });

  return app;
}
