import { afterEach, describe, expect, it, vi } from "vitest";

import type { RetrievedDocument } from "../src/contracts.js";
import { runAgent } from "../src/services/agent/server.js";

const relevant: RetrievedDocument[] = [
  { id: "runbook", title: "Runbook", relevance: 0.95, content: "Use a fallback model." },
];

afterEach(() => vi.unstubAllEnvs());

describe("agent workflow", () => {
  it("completes a grounded workflow and records AI usage", async () => {
    const result = await runAgent(
      { question: "How should an incident be handled?", scenario: "healthy" },
      async () => ({ documents: relevant, durationMs: 3 }),
    );

    expect(result.status).toBe("completed");
    expect(result.evaluation).toEqual({
      grounded: true,
      toolSucceeded: true,
      validationPassed: true,
      score: 0.96,
    });
    expect(result.traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(result.steps.map((step) => step.name)).toEqual([
      "retrieval.search",
      "gen_ai.chat",
      "incident.ticket.lookup",
    ]);
  });

  it("blocks an ungrounded response before model and tool execution", async () => {
    const result = await runAgent(
      { question: "How should an incident be handled?", scenario: "irrelevant-context" },
      async () => ({
        documents: [{ id: "menu", title: "Menu", relevance: 0.12, content: "Lunch" }],
        durationMs: 2,
      }),
    );

    expect(result.status).toBe("blocked");
    expect(result.failure?.category).toBe("retrieval_quality");
    expect(result.steps.at(-1)?.name).toBe("grounding.validate");
  });

  it("captures a tool dependency failure with the failed step", async () => {
    const result = await runAgent(
      { question: "How should an incident be handled?", scenario: "tool-error" },
      async () => ({ documents: relevant, durationMs: 2 }),
    );

    expect(result.status).toBe("failed");
    expect(result.failure).toMatchObject({
      category: "tool_dependency_error",
      service: "simulated-worker-boundary",
      step: "incident.ticket.lookup",
    });
  });

  it("exercises the backend error-tracking path with an unhandled exception", async () => {
    const result = await runAgent(
      { question: "How should an incident be handled?", scenario: "error-tracking" },
      async () => ({ documents: relevant, durationMs: 2 }),
    );

    expect(result.status).toBe("failed");
    expect(result.failure).toMatchObject({
      category: "unhandled_error",
      service: "agent-service",
      message: "simulated ticket parser invariant failed",
    });
  });

  it("exposes a measurable token cost spike", async () => {
    const normal = await runAgent(
      { question: "How should an incident be handled?", scenario: "healthy" },
      async () => ({ documents: relevant, durationMs: 2 }),
    );
    const spike = await runAgent(
      { question: "How should an incident be handled?", scenario: "cost-spike" },
      async () => ({ documents: relevant, durationMs: 2 }),
    );

    expect(spike.usage.estimatedCostUsd).toBeGreaterThan(normal.usage.estimatedCostUsd * 10);
  });

  it("records the primary attempt, retry, and fallback path for a provider outage", async () => {
    vi.stubEnv("FAILURE_DELAY_MS", "1");
    const result = await runAgent(
      { question: "How should an incident be handled?", scenario: "provider-timeout" },
      async () => ({ documents: relevant, durationMs: 2 }),
    );

    expect(result.status).toBe("failed");
    expect(result.failure?.step).toBe("gen_ai.fallback");
    expect(result.steps.map((step) => step.name)).toEqual([
      "retrieval.search",
      "gen_ai.chat",
      "gen_ai.retry",
      "gen_ai.fallback",
    ]);
    expect(result.steps.slice(1).every((step) => step.status === "error")).toBe(true);
  });
});
