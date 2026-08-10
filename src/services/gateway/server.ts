import { timingSafeEqual } from "node:crypto";

import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";

import {
  bearerToken,
  createOidcTokenVerifierFromEnv,
  hasRole,
  type AuthenticatedPrincipal,
  type PlatformRole,
  type TokenVerifier,
} from "../../auth/authorizer.js";

import { createFixtureAdapters } from "../../adapters/replay.js";
import {
  ReplayRequestSchema,
  WorkflowRequestSchema,
  type ReplayComparison,
  type ReplayRecord,
  type RetrievedDocument,
  type WorkflowResult,
} from "../../contracts.js";
import { ReplayStore } from "../../replay/store.js";
import type { ReplayRepository } from "../../replay/repository.js";
import {
  runAgent,
  type AgentExecutionOptions,
  type RecordedAgentExecution,
} from "../agent/server.js";
import { logger } from "../../telemetry/logger.js";
import { inSpan, telemetry } from "../../telemetry/signals.js";

const agentUrl = () => process.env.AGENT_SERVICE_URL ?? "http://localhost:4001";

function publicResult(payload: WorkflowResult & { retrievedDocuments?: RetrievedDocument[] }): WorkflowResult {
  const result = { ...payload };
  delete result.retrievedDocuments;
  delete (result as Partial<RecordedAgentExecution>).replayFixture;
  return result;
}

function compare(
  record: ReplayRecord,
  replay: WorkflowResult,
  mode: "fixture" | "live",
): ReplayComparison {
  const originalPath = record.result.steps.map((step) => step.name).join("|");
  const replayPath = replay.steps.map((step) => step.name).join("|");
  const changed = {
    status: record.result.status !== replay.status,
    answer: record.result.answer !== replay.answer,
    toolPath: originalPath !== replayPath,
    validation: record.result.evaluation.validationPassed !== replay.evaluation.validationPassed,
    cost: record.result.usage.estimatedCostUsd !== replay.usage.estimatedCostUsd,
    promptVersion: record.result.metadata.promptVersion !== replay.metadata.promptVersion,
    configVersion: record.result.metadata.configVersion !== replay.metadata.configVersion,
    codeVersion: record.result.metadata.codeVersion !== replay.metadata.codeVersion,
  };
  return {
    originalTraceId: record.originalTraceId,
    replayTraceId: replay.traceId,
    mode,
    changed,
    driftDetected: Object.values(changed).some(Boolean),
    original: record.result,
    replay,
  };
}

async function callAgent(body: unknown): Promise<RecordedAgentExecution> {
  const response = await fetch(`${agentUrl()}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Number(process.env.AGENT_TIMEOUT_MS ?? 6_000)),
  });
  if (!response.ok) throw new Error(`agent service returned ${response.status}`);
  return (await response.json()) as RecordedAgentExecution;
}

type ExecuteAgent = typeof callAgent;
type WorkflowRunner = typeof runAgent;

type GatewayReplayOptions = {
  codeRunners?: Record<string, WorkflowRunner>;
  tokenVerifier?: TokenVerifier | null;
};

function hasValidApiKey(candidate: string | string[] | undefined): boolean {
  const expected = process.env.SPANREPLAY_API_KEY;
  if (!expected) return true;
  if (typeof candidate !== "string") return false;
  const expectedBuffer = Buffer.from(expected);
  const candidateBuffer = Buffer.from(candidate);
  return expectedBuffer.length === candidateBuffer.length && timingSafeEqual(expectedBuffer, candidateBuffer);
}

async function fixtureReplay(
  record: ReplayRecord,
  request: ReturnType<typeof ReplayRequestSchema.parse>,
  runner: WorkflowRunner,
): Promise<WorkflowResult> {
  return inSpan(
    "replay_workflow fixture",
    {
      "ai.replay.mode": "fixture",
      "ai.replay.original_trace_id": record.originalTraceId,
      "failure.scenario": record.request.scenario,
    },
    async () => publicResult(await runner(
      {
        ...record.request,
        promptVersion: request.promptVersion ?? record.result.metadata.promptVersion,
        replayOf: record.originalTraceId,
      },
      createFixtureAdapters(record.fixture, {
        toolOutcome: request.overrides?.toolOutcome,
      }),
      {
        configVersion: request.configVersion
          ?? (record.result.metadata.configVersion as AgentExecutionOptions["configVersion"] | undefined),
        codeVersion: request.codeVersion ?? record.result.metadata.codeVersion,
        groundingThreshold: request.overrides?.groundingThreshold,
      },
    )),
  );
}

export function buildGatewayServer(
  store: ReplayRepository = new ReplayStore(),
  executeAgent: ExecuteAgent = callAgent,
  replayOptions: GatewayReplayOptions = {},
) {
  const app = Fastify({ loggerInstance: logger, bodyLimit: 1_048_576 });
  const tokenVerifier = replayOptions.tokenVerifier === undefined
    ? createOidcTokenVerifierFromEnv()
    : replayOptions.tokenVerifier;
  const principals = new WeakMap<object, AuthenticatedPrincipal>();
  const localPrincipal: AuthenticatedPrincipal = { subject: "local-api-key", tenantId: "local", roles: ["admin"] };
  const principalFor = (request: object) => principals.get(request) ?? localPrincipal;
  const requireRole = (request: object, required: PlatformRole) => hasRole(principalFor(request), required);
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
    if (!request.url.startsWith("/api/")) return;
    if (tokenVerifier) {
      try {
        const principal = await tokenVerifier(bearerToken(request.headers.authorization));
        principals.set(request, principal);
        const required: PlatformRole = request.method === "GET" ? "viewer" : "operator";
        if (hasRole(principal, required)) return;
        logger.warn({ event: "authorization.denied", actor_subject: principal.subject, tenant_id: principal.tenantId, required_role: required }, "request authorization denied");
        return reply.code(403).send({ error: `${required} role is required` });
      } catch (error) {
        logger.warn({ event: "authentication.failed", path: request.url }, "request authentication failed");
        return reply.code(401).send({ error: error instanceof Error ? error.message : "Bearer token is invalid" });
      }
    }
    if (hasValidApiKey(request.headers["x-spanreplay-api-key"])) {
      principals.set(request, localPrincipal);
      return;
    }
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

    const principal = principalFor(request);
    const workflowRequest = { ...parsed.data, tenantId: principal.tenantId };
    const execution = await inSpan(
      "spanreplay.workflow",
      {
        "gen_ai.operation.name": "invoke_agent",
        "gen_ai.agent.name": "incident-assistant",
        "failure.scenario": parsed.data.scenario,
        "ai.prompt.version": parsed.data.promptVersion,
      },
      () => executeAgent(workflowRequest),
    );
    const result = publicResult(execution);
    if (!execution.replayFixture) {
      return reply.code(502).send({ error: "Agent response did not include a replay fixture" });
    }
    await store.save(workflowRequest, result, execution.replayFixture);
    return reply.code(200).send(result);
  });

  app.get("/api/replays", async (request) => {
    const query = request.query as { limit?: string };
    const requestedLimit = Number(query.limit ?? 25);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 100)
      : 25;
    const principal = principalFor(request);
    const records = (await store.list(100))
      .filter((record) => (record.request.tenantId ?? "local") === principal.tenantId)
      .slice(0, limit);
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
      const record = await store.get((request.params as { traceId: string }).traceId);
      if ((record.request.tenantId ?? "local") !== principalFor(request).tenantId) throw new Error("not found");
      return record;
    } catch {
      return reply.code(404).send({ error: "Replay record not found" });
    }
  });

  app.post("/api/replays/:traceId", async (request, reply) => {
    const traceId = (request.params as { traceId: string }).traceId;
    const parsedReplay = ReplayRequestSchema.safeParse(request.body ?? {});
    if (!parsedReplay.success) return reply.code(400).send({ error: parsedReplay.error.flatten() });
    const replayRequest = parsedReplay.data;
    const { mode } = replayRequest;

    let record: ReplayRecord;
    try {
      record = await store.get(traceId);
      if ((record.request.tenantId ?? "local") !== principalFor(request).tenantId) throw new Error("not found");
    } catch {
      return reply.code(404).send({ error: "Replay record not found" });
    }

    const principal = principalFor(request);
    if (mode === "live" && !requireRole(request, "admin")) {
      logger.warn({ event: "replay.authorization_denied", actor_subject: principal.subject, tenant_id: principal.tenantId, replay_mode: mode, original_trace_id: traceId }, "live replay authorization denied");
      return reply.code(403).send({ error: "admin role is required for live replay" });
    }
    if (mode === "live" && !replayRequest.reason) {
      return reply.code(400).send({ error: "A reason of at least eight characters is required for live replay" });
    }
    if (mode === "live" && record.privacy.contentRedacted) {
      return reply.code(409).send({
        error: "Live replay is unavailable because raw request content was not retained",
        hint: "Use fixture replay, or explicitly set SPANREPLAY_REDACT_CONTENT=false in a non-sensitive demo environment.",
      });
    }

    let replay: WorkflowResult;
    if (mode === "fixture") {
      const selectedCodeVersion = replayRequest.codeVersion
        ?? record.result.metadata.codeVersion
        ?? "0.1.0";
      const deployedCodeVersion = process.env.SPANREPLAY_CODE_VERSION ?? "0.1.0";
      const runners: Record<string, WorkflowRunner> = {
        "0.1.0": runAgent,
        current: runAgent,
        [deployedCodeVersion]: runAgent,
        ...replayOptions.codeRunners,
      };
      const runner = runners[selectedCodeVersion];
      if (!runner) {
        return reply.code(400).send({
          error: `Unsupported codeVersion: ${selectedCodeVersion}`,
          availableCodeVersions: Object.keys(runners).sort(),
        });
      }
      replay = await fixtureReplay(record, replayRequest, runner);
    } else {
      if (replayRequest.configVersion || replayRequest.codeVersion || replayRequest.overrides) {
        return reply.code(400).send({
          error: "configVersion, codeVersion, and fixture overrides are only supported in fixture mode",
        });
      }
      replay = publicResult(await executeAgent({
        ...record.request,
        promptVersion: replayRequest.promptVersion ?? record.result.metadata.promptVersion,
        replayOf: record.originalTraceId,
      }));
    }
    const outcome = compare(record, replay, mode);
    telemetry.replay(mode, replay.status);
    logger.info({
      event: "replay.executed",
      actor_subject: principal.subject,
      actor_roles: principal.roles,
      tenant_id: principal.tenantId,
      replay_mode: mode,
      original_trace_id: traceId,
      replay_trace_id: outcome.replayTraceId,
      drift_detected: outcome.driftDetected,
      reason: replayRequest.reason ?? "fixture regression check",
    }, "replay execution audited");
    return outcome;
  });

  return app;
}
