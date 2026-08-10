import { randomBytes } from "node:crypto";

import { SpanStatusCode, metrics, trace, type Attributes } from "@opentelemetry/api";
import {
  enforceMetricAttributePolicy,
  recordErrorForTracking,
  type MetricAttributePolicy,
} from "../../packages/observability-sdk/src/index.js";

const tracer = trace.getTracer("spanreplay.agent-workflows", "0.1.0");
const meter = metrics.getMeter("spanreplay.agent-workflows", "0.1.0");

const workflowDuration = meter.createHistogram("ai.workflow.duration", {
  description: "End-to-end AI workflow duration",
  unit: "ms",
});
const workflowRuns = meter.createCounter("ai.workflow.runs", {
  description: "AI workflow runs by status and scenario",
});
const tokenUsage = meter.createCounter("gen_ai.client.token.usage", {
  description: "Input and output tokens consumed by model calls",
  unit: "{token}",
});
const estimatedCost = meter.createCounter("ai.workflow.estimated.cost", {
  description: "Estimated model cost",
  unit: "USD",
});
const retrievalRelevance = meter.createHistogram("ai.retrieval.relevance", {
  description: "Top retrieved document relevance score",
});
const retrievalConcurrency = meter.createHistogram("ai.retrieval.concurrency", {
  description: "Concurrent retrieval requests observed by the service",
  unit: "{request}",
});
const retrievalAdmissions = meter.createCounter("ai.retrieval.admissions", {
  description: "Retrieval requests admitted or shed at the service boundary",
});
const toolCalls = meter.createCounter("ai.tool.calls", {
  description: "Agent tool-call outcomes",
});
const validationFailures = meter.createCounter("ai.validation.failures", {
  description: "Agent response validation failures",
});
const replayRuns = meter.createCounter("ai.replay.runs", {
  description: "Failure replay attempts by mode",
});
const agentSteps = meter.createHistogram("ai.agent.steps", {
  description: "Number of steps executed by an agent workflow",
  unit: "{step}",
});
const retryRuns = meter.createCounter("ai.agent.retries", {
  description: "Agent dependency retry attempts",
});
const fallbackRuns = meter.createCounter("ai.agent.fallbacks", {
  description: "Agent fallback activations",
});
const groundingOutcomes = meter.createCounter("ai.grounding.outcomes", {
  description: "Grounding gate outcomes",
});

export const metricAttributePolicy = {
  "ai.workflow.duration": ["workflow.status", "failure.scenario"],
  "ai.workflow.runs": ["workflow.status", "failure.scenario"],
  "gen_ai.client.token.usage": ["gen_ai.token.type", "gen_ai.request.model", "gen_ai.provider.name"],
  "ai.workflow.estimated.cost": ["gen_ai.request.model"],
  "ai.retrieval.relevance": ["retrieval.outcome"],
  "ai.retrieval.concurrency": ["retrieval.mode"],
  "ai.retrieval.admissions": ["admission.outcome"],
  "ai.tool.calls": ["tool.name", "tool.outcome"],
  "ai.validation.failures": ["validation.reason"],
  "ai.replay.runs": ["replay.mode", "replay.outcome"],
  "ai.agent.steps": ["workflow.status"],
  "ai.agent.retries": ["dependency.name"],
  "ai.agent.fallbacks": ["fallback.target"],
  "ai.grounding.outcomes": ["grounding.outcome"],
} as const satisfies MetricAttributePolicy;

const attributesFor = (metricName: keyof typeof metricAttributePolicy, attributes: Attributes) =>
  enforceMetricAttributePolicy(metricName, attributes, metricAttributePolicy);

export async function inSpan<T>(
  name: string,
  attributes: Attributes,
  operation: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await operation();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      const fingerprint = error instanceof Error && "category" in error
        ? String((error as Error & { category: unknown }).category)
        : undefined;
      recordErrorForTracking(span, error, fingerprint);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function activeTraceId(): string {
  return trace.getActiveSpan()?.spanContext().traceId ?? randomBytes(16).toString("hex");
}

export const telemetry = {
  workflow(durationMs: number, status: string, scenario: string) {
    const attributes = attributesFor("ai.workflow.duration", { "workflow.status": status, "failure.scenario": scenario });
    workflowDuration.record(durationMs, attributes);
    workflowRuns.add(1, attributesFor("ai.workflow.runs", attributes));
  },
  tokens(input: number, output: number, model: string, provider = "simulated") {
    tokenUsage.add(input, attributesFor("gen_ai.client.token.usage", { "gen_ai.token.type": "input", "gen_ai.request.model": model, "gen_ai.provider.name": provider }));
    tokenUsage.add(output, attributesFor("gen_ai.client.token.usage", { "gen_ai.token.type": "output", "gen_ai.request.model": model, "gen_ai.provider.name": provider }));
  },
  cost(costUsd: number, model: string) {
    estimatedCost.add(costUsd, attributesFor("ai.workflow.estimated.cost", { "gen_ai.request.model": model }));
  },
  retrieval(score: number, outcome: string) {
    retrievalRelevance.record(score, attributesFor("ai.retrieval.relevance", { "retrieval.outcome": outcome }));
  },
  retrievalConcurrency(count: number, mode: string) {
    retrievalConcurrency.record(count, attributesFor("ai.retrieval.concurrency", { "retrieval.mode": mode }));
  },
  retrievalAdmission(outcome: "admitted" | "shed") {
    retrievalAdmissions.add(1, attributesFor("ai.retrieval.admissions", { "admission.outcome": outcome }));
  },
  tool(name: string, succeeded: boolean) {
    toolCalls.add(1, attributesFor("ai.tool.calls", { "tool.name": name, "tool.outcome": succeeded ? "success" : "failure" }));
  },
  validation(reason: string) {
    validationFailures.add(1, attributesFor("ai.validation.failures", { "validation.reason": reason }));
  },
  replay(mode: "fixture" | "live", outcome: string) {
    replayRuns.add(1, attributesFor("ai.replay.runs", { "replay.mode": mode, "replay.outcome": outcome }));
  },
  steps(count: number, outcome: string) {
    agentSteps.record(count, attributesFor("ai.agent.steps", { "workflow.status": outcome }));
  },
  retry(dependency: string) {
    retryRuns.add(1, attributesFor("ai.agent.retries", { "dependency.name": dependency }));
  },
  fallback(target: string) {
    fallbackRuns.add(1, attributesFor("ai.agent.fallbacks", { "fallback.target": target }));
  },
  grounding(outcome: "passed" | "blocked") {
    groundingOutcomes.add(1, attributesFor("ai.grounding.outcomes", { "grounding.outcome": outcome }));
  },
};
