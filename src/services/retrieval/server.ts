import Fastify from "fastify";

import {
  RetrievalRequestSchema,
  type RetrievedDocument,
} from "../../contracts.js";
import { delay, injectDelay } from "../../failures/scenarios.js";
import { logger } from "../../telemetry/logger.js";
import { inSpan, telemetry } from "../../telemetry/signals.js";

const documents: RetrievedDocument[] = [
  {
    id: "runbook-provider-timeout",
    title: "LLM provider timeout runbook",
    relevance: 0.96,
    content: "Retry once with jitter, then route to the configured fallback model and open an incident when the timeout-rate SLO burns.",
  },
  {
    id: "policy-retrieval-quality",
    title: "Retrieval quality policy",
    relevance: 0.91,
    content: "Block grounded answers when the top retrieval score is below 0.70. Record document identifiers, not raw sensitive content.",
  },
  {
    id: "runbook-tool-failure",
    title: "Tool-call failure runbook",
    relevance: 0.87,
    content: "Capture tool name, attempt count, dependency status, and a redacted error. Escalate irreversible operations to human approval.",
  },
];

const irrelevant: RetrievedDocument[] = [
  {
    id: "cafeteria-menu",
    title: "Office cafeteria menu",
    relevance: 0.18,
    content: "Tuesday lunch service begins at noon.",
  },
];

export function buildRetrievalServer() {
  const app = Fastify({ loggerInstance: logger });
  let activeRetrievals = 0;

  app.get("/health", async () => ({ status: "ok", service: "retrieval-service" }));
  app.get("/ready", async () => ({ status: "ready", service: "retrieval-service" }));

  app.post("/retrieve", async (request, reply) => {
    const parsed = RetrievalRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const started = Date.now();
    return inSpan(
      "ai.retriever.search",
      {
        "gen_ai.operation.name": "retrieval",
        "retrieval.query.length": parsed.data.query.length,
        "failure.scenario": parsed.data.scenario,
      },
      async () => {
        const configuredLimit = Number(process.env.MAX_RETRIEVAL_CONCURRENCY ?? Number.POSITIVE_INFINITY);
        if (Number.isFinite(configuredLimit) && activeRetrievals >= configuredLimit) {
          telemetry.retrievalAdmission("shed");
          logger.warn({ retrieval_concurrency: activeRetrievals, concurrency_limit: configuredLimit }, "retrieval request shed");
          return reply
            .header("retry-after", "1")
            .code(429)
            .send({ error: "retrieval_capacity_exceeded", retryAfterSeconds: 1 });
        }
        activeRetrievals += 1;
        telemetry.retrievalAdmission("admitted");
        const observedConcurrency = activeRetrievals;
        try {
          telemetry.retrievalConcurrency(
            observedConcurrency,
            parsed.data.scenario === "retrieval-saturation" ? "saturation-lab" : "normal",
          );
          await injectDelay(parsed.data.scenario, "retrieval");
          if (parsed.data.scenario === "retrieval-saturation") {
            const baseDelay = Number(process.env.SATURATION_BASE_DELAY_MS ?? 20);
            const queueDelay = Math.max(0, observedConcurrency - 4)
              * Number(process.env.SATURATION_QUEUE_DELAY_MS ?? 30);
            await delay(baseDelay + queueDelay);
          }
          const results = parsed.data.scenario === "irrelevant-context" ? irrelevant : documents;
          const topScore = results[0]?.relevance ?? 0;
          telemetry.retrieval(topScore, topScore >= 0.7 ? "relevant" : "irrelevant");
          logger.info(
            {
              document_ids: results.map((document) => document.id),
              top_score: topScore,
              retrieval_concurrency: observedConcurrency,
            },
            "retrieval completed",
          );
          return {
            documents: results,
            durationMs: Date.now() - started,
          };
        } finally {
          activeRetrievals -= 1;
        }
      },
    );
  });

  return app;
}
