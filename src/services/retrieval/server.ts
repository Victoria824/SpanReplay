import Fastify from "fastify";

import {
  RetrievalRequestSchema,
  type RetrievedDocument,
} from "../../contracts.js";
import { injectDelay } from "../../failures/scenarios.js";
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
        await injectDelay(parsed.data.scenario, "retrieval");
        const results = parsed.data.scenario === "irrelevant-context" ? irrelevant : documents;
        const topScore = results[0]?.relevance ?? 0;
        telemetry.retrieval(topScore, topScore >= 0.7 ? "relevant" : "irrelevant");
        logger.info(
          { document_ids: results.map((document) => document.id), top_score: topScore },
          "retrieval completed",
        );
        return {
          documents: results,
          durationMs: Date.now() - started,
        };
      },
    );
  });

  return app;
}
