import { SpanStatusCode, metrics, trace } from "@opentelemetry/api";
import { createHash } from "node:crypto";

type Evaluation = {
  caseId: string;
  provider: string;
  model: string;
  promptVersion: string;
  validator: "schema" | "policy" | "execution" | "result";
  passed: boolean;
  durationMs: number;
};

const tracer = trace.getTracer("queryassure.evaluations");
const meter = metrics.getMeter("queryassure.evaluations");
const runs = meter.createCounter("ai.sql_agent.evaluation.runs");
const duration = meter.createHistogram("ai.sql_agent.evaluation.duration", { unit: "ms" });

export async function instrumentQueryAssureEvaluation<T>(
  evaluation: Evaluation,
  run: () => Promise<T>,
): Promise<T> {
  const caseHash = createHash("sha256").update(evaluation.caseId).digest("hex").slice(0, 16);
  const metricAttributes = {
    "evaluation.validator": evaluation.validator,
    "evaluation.outcome": evaluation.passed ? "pass" : "fail",
    "gen_ai.provider.name": evaluation.provider,
    "gen_ai.request.model": evaluation.model,
  };

  return tracer.startActiveSpan(
    "queryassure.evaluate_sql_agent",
    {
      attributes: {
        ...metricAttributes,
        "evaluation.case_hash": caseHash,
        "ai.prompt.version": evaluation.promptVersion,
      },
    },
    async (span) => {
      try {
        const result = await run();
        runs.add(1, metricAttributes);
        duration.record(evaluation.durationMs, metricAttributes);
        span.setStatus({ code: evaluation.passed ? SpanStatusCode.OK : SpanStatusCode.ERROR });
        return result;
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

