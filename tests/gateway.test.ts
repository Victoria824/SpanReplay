import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentAdapters } from "../src/adapters/types.js";
import type { ReplayFixture, WorkflowResult } from "../src/contracts.js";
import { InjectedFailure } from "../src/failures/scenarios.js";
import { ReplayStore } from "../src/replay/store.js";
import { runAgent, runRecordedAgent } from "../src/services/agent/server.js";
import { buildGatewayServer } from "../src/services/gateway/server.js";

const temporaryDirectories: string[] = [];

const emptyFixture = (): ReplayFixture => ({
  schemaVersion: "2.0",
  retrieval: [],
  model: [],
  tool: [],
});

function testAdapters(relevance = 0.95): AgentAdapters {
  return {
    retrieval: {
      async retrieve() {
        return {
          documents: [
            { id: "runbook", title: "Runbook", relevance, content: "Sensitive fixture body" },
          ],
          durationMs: 3,
        };
      },
    },
    model: {
      async invoke(input) {
        return {
          answer: "Email operator@example.com and use the runbook.",
          usage: { inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.0001 },
          provider: "fixture-provider",
          model: input.model,
        };
      },
    },
    tool: {
      async execute(input) {
        if (input.scenario === "tool-error") {
          throw new InjectedFailure(
            "recorded tool failure",
            "tool_dependency_error",
            "simulated-worker-boundary",
            input.name,
          );
        }
        return { ticket: "INC-TEST-1" };
      },
    },
  };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("gateway and replay API", () => {
  it("enforces OIDC roles and keeps replay evidence tenant-scoped", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "spanreplay-test-"));
    temporaryDirectories.push(directory);
    const principals = {
      "operator-a": { subject: "user-a", tenantId: "tenant-a", roles: ["operator"] as const },
      "viewer-a": { subject: "viewer-a", tenantId: "tenant-a", roles: ["viewer"] as const },
      "operator-b": { subject: "user-b", tenantId: "tenant-b", roles: ["operator"] as const },
    };
    const app = buildGatewayServer(
      new ReplayStore(directory),
      (input) => runRecordedAgent(input, testAdapters()),
      {
        tokenVerifier: async (token) => {
          const principal = principals[token as keyof typeof principals];
          if (!principal) throw new Error("invalid token");
          return { ...principal, roles: [...principal.roles] };
        },
      },
    );

    const anonymous = await app.inject({ method: "GET", url: "/api/replays" });
    const viewerWrite = await app.inject({
      method: "POST",
      url: "/api/workflows",
      headers: { authorization: "Bearer viewer-a" },
      payload: { question: "How should we handle this incident?", scenario: "healthy" },
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/workflows",
      headers: { authorization: "Bearer operator-a" },
      payload: { question: "How should we handle this incident?", scenario: "healthy", tenantId: "tenant-b" },
    });
    const tenantA = await app.inject({
      method: "GET",
      url: "/api/replays",
      headers: { authorization: "Bearer viewer-a" },
    });
    const tenantB = await app.inject({
      method: "GET",
      url: "/api/replays",
      headers: { authorization: "Bearer operator-b" },
    });
    const operatorLive = await app.inject({
      method: "POST",
      url: `/api/replays/${created.json().traceId}`,
      headers: { authorization: "Bearer operator-a" },
      payload: { mode: "live", reason: "incident investigation" },
    });

    expect(anonymous.statusCode).toBe(401);
    expect(viewerWrite.statusCode).toBe(403);
    expect(created.statusCode).toBe(200);
    expect(tenantA.json()).toHaveLength(1);
    expect(tenantB.json()).toHaveLength(0);
    expect(operatorLive.statusCode).toBe(403);
    await app.close();
  });

  it("records sanitized adapter evidence and re-executes the full workflow", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "spanreplay-test-"));
    temporaryDirectories.push(directory);
    const store = new ReplayStore(directory);
    const app = buildGatewayServer(
      store,
      (input) => runRecordedAgent(input, testAdapters()),
    );

    const workflowResponse = await app.inject({
      method: "POST",
      url: "/api/workflows",
      payload: {
        question: "Email operator@example.com about the incident",
        scenario: "healthy",
      },
    });
    expect(workflowResponse.statusCode).toBe(200);
    const traceId = workflowResponse.json().traceId as string;

    const record = await store.get(traceId);
    expect(record.request.question).toBe("[CONTENT_REDACTED]");
    expect(record.result.answer).toBe("[CONTENT_REDACTED]");
    expect(record.fixture.model[0]?.outcome).toMatchObject({
      ok: true,
      value: { answer: "[CONTENT_REDACTED]" },
    });
    expect(JSON.stringify(record)).not.toContain("Sensitive fixture body");
    expect(JSON.stringify(record)).not.toContain("operator@example.com");

    const replayResponse = await app.inject({
      method: "POST",
      url: `/api/replays/${traceId}`,
      payload: { mode: "fixture" },
    });
    expect(replayResponse.statusCode).toBe(200);
    const comparison = replayResponse.json();
    expect(comparison.mode).toBe("fixture");
    expect(comparison.originalTraceId).toBe(traceId);
    expect(comparison.replayTraceId).toMatch(/^[a-f0-9]{32}$/);
    expect(comparison.driftDetected).toBe(false);
    expect(Object.values(comparison.changed).every((changed) => changed === false)).toBe(true);
    expect(comparison.replay.steps.map((step: { name: string }) => step.name)).toEqual([
      "retrieval.search",
      "gen_ai.chat",
      "incident.ticket.lookup",
    ]);

    await app.close();
  });

  it("detects drift when a stricter configuration changes the grounding decision", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "spanreplay-test-"));
    temporaryDirectories.push(directory);
    const store = new ReplayStore(directory);
    const app = buildGatewayServer(
      store,
      (input) => runRecordedAgent(input, testAdapters(0.96)),
      { codeRunners: { "candidate-v2": runAgent } },
    );
    const original = await app.inject({
      method: "POST",
      url: "/api/workflows",
      payload: { question: "How should this incident be handled?", scenario: "healthy" },
    });

    const replay = await app.inject({
      method: "POST",
      url: `/api/replays/${original.json().traceId}`,
      payload: {
        mode: "fixture",
        promptVersion: "support-agent-v2",
        configVersion: "strict-v2",
        codeVersion: "candidate-v2",
      },
    });
    const comparison = replay.json();
    expect(comparison.driftDetected).toBe(true);
    expect(comparison.changed).toMatchObject({
      status: true,
      toolPath: true,
      validation: true,
      promptVersion: true,
      configVersion: true,
      codeVersion: true,
    });
    expect(comparison.replay.status).toBe("blocked");
    await app.close();
  });

  it("detects drift when a recorded tool failure is overridden to success", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "spanreplay-test-"));
    temporaryDirectories.push(directory);
    const store = new ReplayStore(directory);
    const app = buildGatewayServer(
      store,
      (input) => runRecordedAgent(input, testAdapters()),
    );
    const original = await app.inject({
      method: "POST",
      url: "/api/workflows",
      payload: { question: "How should this incident be handled?", scenario: "tool-error" },
    });
    expect(original.json().status).toBe("failed");

    const replay = await app.inject({
      method: "POST",
      url: `/api/replays/${original.json().traceId}`,
      payload: { mode: "fixture", overrides: { toolOutcome: "success" } },
    });
    const comparison = replay.json();
    expect(comparison.driftDetected).toBe(true);
    expect(comparison.changed.status).toBe(true);
    expect(comparison.changed.validation).toBe(true);
    expect(comparison.replay.status).toBe("completed");
    await app.close();
  });

  it("refuses live replay when raw content was not retained", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "spanreplay-test-"));
    temporaryDirectories.push(directory);
    const traceId = "b".repeat(32);
    const result: WorkflowResult = {
      traceId,
      status: "failed",
      answer: null,
      failure: { category: "provider_timeout", service: "agent-service", step: "gen_ai.chat", message: "timeout" },
      steps: [],
      usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
      evaluation: { grounded: false, toolSucceeded: false, validationPassed: false, score: 0 },
      metadata: {
        scenario: "provider-timeout",
        promptVersion: "support-agent-v1",
        model: "deterministic-demo-model",
        retrievedDocumentIds: [],
      },
    };
    const store = new ReplayStore(directory);
    await store.save(
      { question: "private incident detail", scenario: "provider-timeout", promptVersion: "support-agent-v1", model: "deterministic-demo-model" },
      result,
      emptyFixture(),
    );
    const app = buildGatewayServer(store, async () => ({
      ...result,
      retrievedDocuments: [],
      replayFixture: emptyFixture(),
    }));

    const response = await app.inject({
      method: "POST",
      url: `/api/replays/${traceId}`,
      payload: { mode: "live", reason: "incident investigation" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain("raw request content was not retained");
    await app.close();
  });

  it("enforces the optional constant-time API key boundary", async () => {
    vi.stubEnv("SPANREPLAY_API_KEY", "local-test-secret");
    const directory = await mkdtemp(path.join(os.tmpdir(), "spanreplay-test-"));
    temporaryDirectories.push(directory);
    const app = buildGatewayServer(new ReplayStore(directory));

    const denied = await app.inject({ method: "GET", url: "/api/replays" });
    const allowed = await app.inject({
      method: "GET",
      url: "/api/replays",
      headers: { "x-spanreplay-api-key": "local-test-secret" },
    });

    expect(denied.statusCode).toBe(401);
    expect(allowed.statusCode).toBe(200);
    await app.close();
  });
});
