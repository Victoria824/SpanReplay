import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { RetrievedDocument, WorkflowResult } from "../src/contracts.js";
import { ReplayStore } from "../src/replay/store.js";
import { buildGatewayServer } from "../src/services/gateway/server.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("gateway and replay API", () => {
  it("records a sanitized workflow and deterministically replays it", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "spanreplay-test-"));
    temporaryDirectories.push(directory);
    const store = new ReplayStore(directory);
    const traceId = "a".repeat(32);
    const documents: RetrievedDocument[] = [
      { id: "runbook", title: "Runbook", relevance: 0.95, content: "Sensitive fixture body" },
    ];
    const result: WorkflowResult = {
      traceId,
      status: "completed",
      answer: "Email operator@example.com and use the runbook.",
      failure: null,
      steps: [
        { name: "retrieval.search", service: "retrieval-service", status: "ok", durationMs: 4, attributes: {} },
      ],
      usage: { inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.0001 },
      evaluation: { grounded: true, toolSucceeded: true, validationPassed: true, score: 1 },
      metadata: {
        scenario: "healthy",
        promptVersion: "support-agent-v1",
        model: "deterministic-demo-model",
        retrievedDocumentIds: ["runbook"],
      },
    };
    const app = buildGatewayServer(store, async () => ({ ...result, retrievedDocuments: documents }));

    const workflowResponse = await app.inject({
      method: "POST",
      url: "/api/workflows",
      payload: {
        question: "Email operator@example.com about the incident",
        scenario: "healthy",
      },
    });
    expect(workflowResponse.statusCode).toBe(200);

    const record = await store.get(traceId);
    expect(record.request.question).toBe("[CONTENT_REDACTED]");
    expect(record.result.answer).toBe("[CONTENT_REDACTED]");
    expect(record.fixture.answer).toBe("[CONTENT_REDACTED]");
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
    expect(comparison.changed).toEqual({
      status: false,
      answer: false,
      toolPath: false,
      validation: false,
    });

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
      [],
    );
    const app = buildGatewayServer(store, async () => ({ ...result, retrievedDocuments: [] }));

    const response = await app.inject({
      method: "POST",
      url: `/api/replays/${traceId}`,
      payload: { mode: "live" },
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
