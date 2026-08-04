import Fastify from "fastify";

import {
  WorkflowRequestSchema,
  type RetrievedDocument,
  type Usage,
  type WorkflowResult,
  type WorkflowStep,
} from "../../contracts.js";
import { InjectedFailure, delay, injectDelay } from "../../failures/scenarios.js";
import { logger } from "../../telemetry/logger.js";
import { activeTraceId, inSpan, telemetry } from "../../telemetry/signals.js";

const retrievalUrl = () => process.env.RETRIEVAL_SERVICE_URL ?? "http://localhost:4002";

type AgentExecution = WorkflowResult & { retrievedDocuments: RetrievedDocument[] };

type RetrievalResult = { documents: RetrievedDocument[]; durationMs: number };
type Retrieve = (
  query: string,
  scenario: ReturnType<typeof WorkflowRequestSchema.parse>["scenario"],
) => Promise<RetrievalResult>;

async function callRetrieval(
  query: string,
  scenario: ReturnType<typeof WorkflowRequestSchema.parse>["scenario"],
): Promise<RetrievalResult> {
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
  return (await retrievalResponse.json()) as RetrievalResult;
}

function usageFor(scenario: string): Usage {
  const multiplier = scenario === "cost-spike" ? 12 : 1;
  const inputTokens = 228 * multiplier;
  const outputTokens = 92 * multiplier;
  return {
    inputTokens,
    outputTokens,
    estimatedCostUsd: Number(((inputTokens * 0.0000025 + outputTokens * 0.00001)).toFixed(6)),
  };
}

function failureResult(
  traceId: string,
  request: ReturnType<typeof WorkflowRequestSchema.parse>,
  error: unknown,
  steps: WorkflowStep[],
): AgentExecution {
  const injected = error instanceof InjectedFailure ? error : undefined;
  const usage = usageFor(request.scenario);
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
    usage,
    evaluation: { grounded: false, toolSucceeded: false, validationPassed: false, score: 0 },
    metadata: {
      scenario: request.scenario,
      promptVersion: request.promptVersion,
      model: request.model,
      retrievedDocumentIds: [],
      ...(request.replayOf ? { replayOf: request.replayOf } : {}),
    },
    retrievedDocuments: [],
  };
}

async function runAgent(input: unknown, retrieve: Retrieve = callRetrieval): Promise<AgentExecution> {
  const request = WorkflowRequestSchema.parse(input);
  return inSpan(
    "invoke_agent incident-assistant",
    {
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.agent.name": "incident-assistant",
      "gen_ai.request.model": request.model,
      "ai.prompt.version": request.promptVersion,
      "failure.scenario": request.scenario,
      ...(request.replayOf ? { "ai.replay.original_trace_id": request.replayOf } : {}),
    },
    async () => {
      const traceId = activeTraceId();
      const steps: WorkflowStep[] = [];
      const workflowStarted = Date.now();
      let retrievedDocuments: RetrievedDocument[];

      try {
        const retrievalStarted = Date.now();
        let retrievalResponse: RetrievalResult;
        try {
          retrievalResponse = await inSpan(
            "retrieval.search",
            { "peer.service": "retrieval-service" },
            () => retrieve(request.question, request.scenario),
          );
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
        const retrieval = retrievalResponse;
        retrievedDocuments = retrieval.documents;
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

        if ((retrievedDocuments[0]?.relevance ?? 0) < 0.7) {
          const usage = usageFor(request.scenario);
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
              message: "Top retrieval score is below the 0.70 grounding threshold",
            },
            steps: [
              ...steps,
              {
                name: "grounding.validate",
                service: "agent-service",
                status: "blocked",
                durationMs: 1,
                attributes: { threshold: 0.7 },
              },
            ],
            usage,
            evaluation: { grounded: false, toolSucceeded: false, validationPassed: false, score: 0.18 },
            metadata: {
              scenario: request.scenario,
              promptVersion: request.promptVersion,
              model: request.model,
              retrievedDocumentIds: retrievedDocuments.map((document) => document.id),
            },
            retrievedDocuments,
          };
          telemetry.workflow(Date.now() - workflowStarted, result.status, request.scenario);
          telemetry.steps(result.steps.length, result.status);
          return result;
        }
        telemetry.grounding("passed");

        const modelStarted = Date.now();
        const usage = usageFor(request.scenario);
        let answer: string;
        try {
          answer = await inSpan(
            "chat deterministic-demo-model",
            {
              "gen_ai.operation.name": "chat",
              "gen_ai.provider.name": "simulated",
              "gen_ai.request.model": request.model,
              "gen_ai.usage.input_tokens": usage.inputTokens,
              "gen_ai.usage.output_tokens": usage.outputTokens,
              "ai.provider.attempt": 1,
            },
            async () => {
              await injectDelay(request.scenario, "provider");
              return request.scenario === "validation-failure"
                ? "Delete the affected production records immediately without approval."
                : "The incident runbook recommends one jittered retry, then a fallback model, while preserving the trace ID for escalation.";
            },
          );
        } catch (error) {
          steps.push({
            name: "gen_ai.chat",
            service: "agent-service",
            status: "error",
            durationMs: Date.now() - modelStarted,
            attributes: { model: request.model, attempt: 1 },
          });

          if (request.scenario === "provider-timeout") {
            telemetry.retry("simulated-primary-provider");
            const retryStarted = Date.now();
            try {
              await inSpan(
                "chat deterministic-demo-model retry",
                {
                  "gen_ai.operation.name": "chat",
                  "gen_ai.provider.name": "simulated",
                  "gen_ai.request.model": request.model,
                  "ai.provider.attempt": 2,
                },
                async () => {
                  await delay(25);
                  throw new InjectedFailure(
                    "primary provider retry exceeded its timeout budget",
                    "dependency_timeout",
                    "agent-service",
                    "gen_ai.retry",
                    504,
                  );
                },
              );
            } catch {
              steps.push({
                name: "gen_ai.retry",
                service: "agent-service",
                status: "error",
                durationMs: Date.now() - retryStarted,
                attributes: { model: request.model, attempt: 2 },
              });
            }

            telemetry.fallback("simulated-fallback-provider");
            const fallbackStarted = Date.now();
            try {
              await inSpan(
                "chat fallback-demo-model",
                {
                  "gen_ai.operation.name": "chat",
                  "gen_ai.provider.name": "simulated-fallback",
                  "gen_ai.request.model": "fallback-demo-model",
                  "ai.provider.attempt": 3,
                },
                async () => {
                  await delay(25);
                  throw new InjectedFailure(
                    "fallback provider exceeded its timeout budget",
                    "dependency_timeout",
                    "agent-service",
                    "gen_ai.fallback",
                    504,
                  );
                },
              );
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
          throw error;
        }
        telemetry.tokens(usage.inputTokens, usage.outputTokens, request.model);
        telemetry.cost(usage.estimatedCostUsd, request.model);
        steps.push({
          name: "gen_ai.chat",
          service: "agent-service",
          status: "ok",
          durationMs: Date.now() - modelStarted,
          attributes: {
            model: request.model,
            promptVersion: request.promptVersion,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
          },
        });

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
            metadata: {
              scenario: request.scenario,
              promptVersion: request.promptVersion,
              model: request.model,
              retrievedDocumentIds: retrievedDocuments.map((document) => document.id),
            },
            retrievedDocuments,
          };
          telemetry.workflow(Date.now() - workflowStarted, result.status, request.scenario);
          telemetry.steps(result.steps.length, result.status);
          return result;
        }

        const toolStarted = Date.now();
        try {
          await inSpan(
            "execute_tool incident.ticket.lookup",
            { "gen_ai.operation.name": "execute_tool", "tool.name": "incident.ticket.lookup" },
            async () => {
              if (request.scenario === "tool-error") {
                telemetry.tool("incident.ticket.lookup", false);
                throw new InjectedFailure(
                  "ticket service returned a simulated 503",
                  "tool_dependency_error",
                  "worker-service",
                  "incident.ticket.lookup",
                );
              }
              telemetry.tool("incident.ticket.lookup", true);
            },
          );
        } catch (error) {
          steps.push({
            name: "incident.ticket.lookup",
            service: "worker-service",
            status: "error",
            durationMs: Date.now() - toolStarted,
            attributes: { attempts: 1 },
          });
          throw error;
        }
        steps.push({
          name: "incident.ticket.lookup",
          service: "worker-service",
          status: "ok",
          durationMs: Date.now() - toolStarted,
          attributes: { ticket: "INC-DEMO-1042", attempts: 1 },
        });

        const result: AgentExecution = {
          traceId,
          status: "completed",
          answer,
          failure: null,
          steps,
          usage,
          evaluation: { grounded: true, toolSucceeded: true, validationPassed: true, score: 0.96 },
          metadata: {
            scenario: request.scenario,
            promptVersion: request.promptVersion,
            model: request.model,
            retrievedDocumentIds: retrievedDocuments.map((document) => document.id),
            ...(request.replayOf ? { replayOf: request.replayOf } : {}),
          },
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
        const result = failureResult(traceId, request, error, steps);
        telemetry.workflow(Date.now() - workflowStarted, result.status, request.scenario);
        telemetry.steps(result.steps.length, result.status);
        logger.error({ err: error, scenario: request.scenario }, "agent workflow failed");
        return result;
      }
    },
  );
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
    return runAgent(parsed.data);
  });
  return app;
}

export { runAgent };
