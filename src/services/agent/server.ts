import Fastify from "fastify";

import { createRecordingAdapters } from "../../adapters/replay.js";
import { createRuntimeAdapters, usageFor } from "../../adapters/runtime.js";
import type { AgentAdapters } from "../../adapters/types.js";
import {
  WorkflowRequestSchema,
  type ModelAdapterOutput,
  type ReplayFixture,
  type RetrievedDocument,
  type WorkflowConfigVersion,
  type WorkflowResult,
  type WorkflowStep,
} from "../../contracts.js";
import { InjectedFailure } from "../../failures/scenarios.js";
import { errorLogFields } from "../../../packages/observability-sdk/src/index.js";
import { logger } from "../../telemetry/logger.js";
import { activeTraceId, inSpan, telemetry } from "../../telemetry/signals.js";

const retrievalUrl = () => process.env.RETRIEVAL_SERVICE_URL ?? "http://localhost:4002";

export type AgentExecution = WorkflowResult & { retrievedDocuments: RetrievedDocument[] };
export type RecordedAgentExecution = AgentExecution & { replayFixture: ReplayFixture };

export type AgentExecutionOptions = {
  configVersion?: WorkflowConfigVersion;
  codeVersion?: string;
  groundingThreshold?: number;
};

type LegacyRetrieve = (
  query: string,
  scenario: ReturnType<typeof WorkflowRequestSchema.parse>["scenario"],
) => Promise<{ documents: RetrievedDocument[]; durationMs: number }>;

function resolveOptions(options: AgentExecutionOptions = {}) {
  const configVersion = options.configVersion ?? "config-v1";
  return {
    configVersion,
    codeVersion: options.codeVersion ?? process.env.SPANREPLAY_CODE_VERSION ?? "0.1.0",
    groundingThreshold: options.groundingThreshold
      ?? (configVersion === "strict-v2" ? 0.99 : 0.7),
  };
}

function resolveAdapters(adapters: AgentAdapters | LegacyRetrieve | undefined): AgentAdapters {
  const runtime = createRuntimeAdapters();
  if (!adapters) return runtime;
  if (typeof adapters !== "function") return adapters;
  return {
    ...runtime,
    retrieval: {
      retrieve: ({ query, scenario }) => adapters(query, scenario),
    },
  };
}

function resultMetadata(
  request: ReturnType<typeof WorkflowRequestSchema.parse>,
  retrievedDocuments: RetrievedDocument[],
  options: ReturnType<typeof resolveOptions>,
) {
  return {
    scenario: request.scenario,
    promptVersion: request.promptVersion,
    model: request.model,
    retrievedDocumentIds: retrievedDocuments.map((document) => document.id),
    configVersion: options.configVersion,
    codeVersion: options.codeVersion,
    groundingThreshold: options.groundingThreshold,
    ...(request.replayOf ? { replayOf: request.replayOf } : {}),
  };
}

function failureResult(
  traceId: string,
  request: ReturnType<typeof WorkflowRequestSchema.parse>,
  error: unknown,
  steps: WorkflowStep[],
  retrievedDocuments: RetrievedDocument[],
  options: ReturnType<typeof resolveOptions>,
): AgentExecution {
  const injected = error instanceof InjectedFailure ? error : undefined;
  return {
    traceId,
    status: "failed",
    answer: null,
    failure: {
      category: injected?.category ?? "unhandled_error",
      service: injected?.service ?? "agent-service",
      step: injected?.step ?? "workflow",
      message: error instanceof Error ? error.message : String(error),
    },
    steps,
    usage: usageFor(request.scenario),
    evaluation: { grounded: false, toolSucceeded: false, validationPassed: false, score: 0 },
    metadata: resultMetadata(request, retrievedDocuments, options),
    retrievedDocuments,
  };
}

export async function runAgent(
  input: unknown,
  adapterInput?: AgentAdapters | LegacyRetrieve,
  executionOptions: AgentExecutionOptions = {},
): Promise<AgentExecution> {
  const request = WorkflowRequestSchema.parse(input);
  const adapters = resolveAdapters(adapterInput);
  const options = resolveOptions(executionOptions);
  return inSpan(
    "invoke_agent incident-assistant",
    {
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.agent.name": "incident-assistant",
      "gen_ai.request.model": request.model,
      "ai.prompt.version": request.promptVersion,
      "ai.config.version": options.configVersion,
      "ai.code.version": options.codeVersion,
      "ai.grounding.threshold": options.groundingThreshold,
      "failure.scenario": request.scenario,
      ...(request.replayOf ? { "ai.replay.original_trace_id": request.replayOf } : {}),
    },
    async () => {
      const traceId = activeTraceId();
      const steps: WorkflowStep[] = [];
      const workflowStarted = Date.now();
      let retrievedDocuments: RetrievedDocument[] = [];

      try {
        const retrievalStarted = Date.now();
        try {
          const retrieval = await inSpan(
            "retrieval.search",
            { "peer.service": "retrieval-service" },
            () => adapters.retrieval.retrieve({ query: request.question, scenario: request.scenario }),
          );
          retrievedDocuments = retrieval.documents;
        } catch (error) {
          steps.push({
            name: "retrieval.search",
            service: "retrieval-service",
            status: "error",
            durationMs: Date.now() - retrievalStarted,
            attributes: { errorCategory: error instanceof InjectedFailure ? error.category : "unhandled_error" },
          });
          throw error;
        }
        steps.push({
          name: "retrieval.search",
          service: "retrieval-service",
          status: "ok",
          durationMs: Date.now() - retrievalStarted,
          attributes: {
            documentCount: retrievedDocuments.length,
            topRelevance: retrievedDocuments[0]?.relevance ?? 0,
          },
        });

        if ((retrievedDocuments[0]?.relevance ?? 0) < options.groundingThreshold) {
          telemetry.validation("retrieval_below_threshold");
          telemetry.grounding("blocked");
          const result: AgentExecution = {
            traceId,
            status: "blocked",
            answer: null,
            failure: {
              category: "retrieval_quality",
              service: "agent-service",
              step: "grounding-gate",
              message: `Top retrieval score is below the ${options.groundingThreshold.toFixed(2)} grounding threshold`,
            },
            steps: [
              ...steps,
              {
                name: "grounding.validate",
                service: "agent-service",
                status: "blocked",
                durationMs: 1,
                attributes: { threshold: options.groundingThreshold },
              },
            ],
            usage: usageFor(request.scenario),
            evaluation: { grounded: false, toolSucceeded: false, validationPassed: false, score: 0.18 },
            metadata: resultMetadata(request, retrievedDocuments, options),
            retrievedDocuments,
          };
          telemetry.workflow(Date.now() - workflowStarted, result.status, request.scenario);
          telemetry.steps(result.steps.length, result.status);
          return result;
        }
        telemetry.grounding("passed");

        const modelInput = (attempt: "primary" | "retry" | "fallback", model = request.model) => ({
          question: request.question,
          documents: retrievedDocuments,
          scenario: request.scenario,
          promptVersion: request.promptVersion,
          model,
          attempt,
        } as const);
        const invokeModel = (
          attempt: "primary" | "retry" | "fallback",
          model: string,
          provider: string,
        ) => inSpan(
          attempt === "primary" ? `chat ${model}` : `chat ${model} ${attempt}`,
          {
            "gen_ai.operation.name": "chat",
            "gen_ai.provider.name": provider,
            "gen_ai.request.model": model,
            "ai.provider.attempt": attempt === "primary" ? 1 : attempt === "retry" ? 2 : 3,
          },
          () => adapters.model.invoke(modelInput(attempt, model)),
        );

        let modelResult: ModelAdapterOutput;
        const modelStarted = Date.now();
        try {
          modelResult = await invokeModel("primary", request.model, "simulated");
          steps.push({
            name: "gen_ai.chat",
            service: "agent-service",
            status: "ok",
            durationMs: Date.now() - modelStarted,
            attributes: {
              model: modelResult.model,
              promptVersion: request.promptVersion,
              inputTokens: modelResult.usage.inputTokens,
              outputTokens: modelResult.usage.outputTokens,
            },
          });
        } catch (primaryError) {
          steps.push({
            name: "gen_ai.chat",
            service: "agent-service",
            status: "error",
            durationMs: Date.now() - modelStarted,
            attributes: { model: request.model, attempt: 1 },
          });
          if (request.scenario !== "provider-timeout") throw primaryError;

          telemetry.retry("simulated-primary-provider");
          const retryStarted = Date.now();
          try {
            modelResult = await invokeModel("retry", request.model, "simulated");
            steps.push({
              name: "gen_ai.retry",
              service: "agent-service",
              status: "ok",
              durationMs: Date.now() - retryStarted,
              attributes: { model: request.model, attempt: 2 },
            });
          } catch {
            steps.push({
              name: "gen_ai.retry",
              service: "agent-service",
              status: "error",
              durationMs: Date.now() - retryStarted,
              attributes: { model: request.model, attempt: 2 },
            });
            telemetry.fallback("simulated-fallback-provider");
            const fallbackStarted = Date.now();
            try {
              modelResult = await invokeModel("fallback", "fallback-demo-model", "simulated-fallback");
              steps.push({
                name: "gen_ai.fallback",
                service: "agent-service",
                status: "ok",
                durationMs: Date.now() - fallbackStarted,
                attributes: { model: modelResult.model, attempt: 3 },
              });
            } catch (fallbackError) {
              steps.push({
                name: "gen_ai.fallback",
                service: "agent-service",
                status: "error",
                durationMs: Date.now() - fallbackStarted,
                attributes: { model: "fallback-demo-model", attempt: 3 },
              });
              throw fallbackError;
            }
          }
        }

        const { answer, usage } = modelResult;
        telemetry.tokens(usage.inputTokens, usage.outputTokens, modelResult.model, modelResult.provider);
        telemetry.cost(usage.estimatedCostUsd, modelResult.model);

        if (request.scenario === "validation-failure") {
          telemetry.validation("unsafe_action_without_approval");
          steps.push({
            name: "response.validate",
            service: "agent-service",
            status: "blocked",
            durationMs: 2,
            attributes: { policy: "approval-required-for-destructive-actions" },
          });
          const result: AgentExecution = {
            traceId,
            status: "blocked",
            answer: null,
            failure: {
              category: "policy_validation",
              service: "agent-service",
              step: "response.validate",
              message: "Unsafe destructive action was blocked by the validation policy",
            },
            steps,
            usage,
            evaluation: { grounded: true, toolSucceeded: false, validationPassed: false, score: 0.25 },
            metadata: resultMetadata(request, retrievedDocuments, options),
            retrievedDocuments,
          };
          telemetry.workflow(Date.now() - workflowStarted, result.status, request.scenario);
          telemetry.steps(result.steps.length, result.status);
          return result;
        }

        const toolStarted = Date.now();
        let toolResult;
        try {
          toolResult = await inSpan(
            "execute_tool incident.ticket.lookup",
            { "gen_ai.operation.name": "execute_tool", "tool.name": "incident.ticket.lookup" },
            () => adapters.tool.execute({ name: "incident.ticket.lookup", scenario: request.scenario }),
          );
          telemetry.tool("incident.ticket.lookup", true);
        } catch (error) {
          telemetry.tool("incident.ticket.lookup", false);
          steps.push({
            name: "incident.ticket.lookup",
            service: "simulated-worker-boundary",
            status: "error",
            durationMs: Date.now() - toolStarted,
            attributes: { attempts: 1 },
          });
          throw error;
        }
        steps.push({
          name: "incident.ticket.lookup",
          service: "simulated-worker-boundary",
          status: "ok",
          durationMs: Date.now() - toolStarted,
          attributes: { ticket: toolResult.ticket, attempts: 1 },
        });

        const result: AgentExecution = {
          traceId,
          status: "completed",
          answer,
          failure: null,
          steps,
          usage,
          evaluation: { grounded: true, toolSucceeded: true, validationPassed: true, score: 0.96 },
          metadata: resultMetadata(request, retrievedDocuments, options),
          retrievedDocuments,
        };
        telemetry.workflow(Date.now() - workflowStarted, result.status, request.scenario);
        telemetry.steps(result.steps.length, result.status);
        logger.info(
          { workflow_status: result.status, scenario: request.scenario, estimated_cost_usd: usage.estimatedCostUsd },
          "agent workflow completed",
        );
        return result;
      } catch (error) {
        const result = failureResult(traceId, request, error, steps, retrievedDocuments, options);
        telemetry.workflow(Date.now() - workflowStarted, result.status, request.scenario);
        telemetry.steps(result.steps.length, result.status);
        const fingerprint = error instanceof InjectedFailure ? error.category : undefined;
        logger.error({ ...errorLogFields(error, fingerprint), scenario: request.scenario }, "agent workflow failed");
        return result;
      }
    },
  );
}

export async function runRecordedAgent(
  input: unknown,
  adapters: AgentAdapters = createRuntimeAdapters(),
  options: AgentExecutionOptions = {},
): Promise<RecordedAgentExecution> {
  const recording = createRecordingAdapters(adapters);
  const result = await runAgent(input, recording.adapters, options);
  return { ...result, replayFixture: recording.snapshot() };
}

export function buildAgentServer() {
  const app = Fastify({ loggerInstance: logger });
  app.get("/health", async () => ({ status: "ok", service: "agent-service" }));
  app.get("/ready", async (_request, reply) => {
    try {
      const response = await fetch(`${retrievalUrl()}/health`, { signal: AbortSignal.timeout(750) });
      if (!response.ok) throw new Error(`retrieval health returned ${response.status}`);
      return { status: "ready", service: "agent-service" };
    } catch {
      return reply.code(503).send({ status: "not-ready", dependency: "retrieval-service" });
    }
  });
  app.post("/run", async (request, reply) => {
    const parsed = WorkflowRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return runRecordedAgent(parsed.data);
  });
  return app;
}
