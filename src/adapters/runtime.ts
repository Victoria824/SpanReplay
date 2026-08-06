import type {
  ModelAdapterInput,
  ModelAdapterOutput,
  RetrievalAdapterOutput,
  Usage,
} from "../contracts.js";
import { InjectedFailure, delay, injectDelay } from "../failures/scenarios.js";
import type { AgentAdapters } from "./types.js";

const retrievalUrl = () => process.env.RETRIEVAL_SERVICE_URL ?? "http://localhost:4002";

export function usageFor(scenario: string): Usage {
  const multiplier = scenario === "cost-spike" ? 12 : 1;
  const inputTokens = 228 * multiplier;
  const outputTokens = 92 * multiplier;
  return {
    inputTokens,
    outputTokens,
    estimatedCostUsd: Number((inputTokens * 0.0000025 + outputTokens * 0.00001).toFixed(6)),
  };
}

async function retrieveRemotely(query: string, scenario: ModelAdapterInput["scenario"]): Promise<RetrievalAdapterOutput> {
  const retrievalResponse = await fetch(`${retrievalUrl()}/retrieve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, scenario }),
    signal: AbortSignal.timeout(Number(process.env.RETRIEVAL_TIMEOUT_MS ?? 2_000)),
  });
  if (!retrievalResponse.ok) {
    const body = (await retrievalResponse.json()) as { error?: string; message?: string };
    throw new InjectedFailure(
      body.message ?? body.error ?? `retrieval returned ${retrievalResponse.status}`,
      "retrieval_dependency_error",
      "retrieval-service",
      "retrieval",
      retrievalResponse.status,
    );
  }
  return (await retrievalResponse.json()) as RetrievalAdapterOutput;
}

async function invokeSimulatedModel(input: ModelAdapterInput): Promise<ModelAdapterOutput> {
  if (input.scenario === "provider-timeout") {
    if (input.attempt === "primary") await injectDelay(input.scenario, "provider");
    await delay(25);
    throw new InjectedFailure(
      input.attempt === "fallback"
        ? "fallback provider exceeded its timeout budget"
        : "primary provider retry exceeded its timeout budget",
      "dependency_timeout",
      "agent-service",
      input.attempt === "primary" ? "provider" : `gen_ai.${input.attempt}`,
      504,
    );
  }

  return {
    answer: input.scenario === "validation-failure"
      ? "Delete the affected production records immediately without approval."
      : "The incident runbook recommends one jittered retry, then a fallback model, while preserving the trace ID for escalation.",
    usage: usageFor(input.scenario),
    provider: "simulated",
    model: input.model,
  };
}

export function createRuntimeAdapters(): AgentAdapters {
  return {
    retrieval: {
      retrieve: ({ query, scenario }) => retrieveRemotely(query, scenario),
    },
    model: {
      invoke: invokeSimulatedModel,
    },
    tool: {
      async execute(input) {
        if (input.scenario === "error-tracking") {
          throw new TypeError("simulated ticket parser invariant failed");
        }
        if (input.scenario === "tool-error") {
          throw new InjectedFailure(
            "ticket service returned a simulated 503",
            "tool_dependency_error",
            "simulated-worker-boundary",
            input.name,
          );
        }
        return { ticket: "INC-DEMO-1042" };
      },
    },
  };
}
