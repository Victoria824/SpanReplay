import { z } from "zod";

export const failureScenarios = [
  "healthy",
  "retrieval-timeout",
  "irrelevant-context",
  "provider-timeout",
  "tool-error",
  "validation-failure",
  "cost-spike",
] as const;

export const FailureScenarioSchema = z.enum(failureScenarios);
export type FailureScenario = z.infer<typeof FailureScenarioSchema>;

export const WorkflowRequestSchema = z.object({
  question: z.string().min(3).max(2_000),
  scenario: FailureScenarioSchema.default("healthy"),
  promptVersion: z.string().min(1).max(80).default("support-agent-v1"),
  model: z.string().min(1).max(120).default("deterministic-demo-model"),
  replayOf: z.string().regex(/^[a-f0-9]{32}$/).optional(),
});

export type WorkflowRequest = z.infer<typeof WorkflowRequestSchema>;

export const RetrievalRequestSchema = z.object({
  query: z.string().min(1).max(2_000),
  scenario: FailureScenarioSchema,
});

export type RetrievalRequest = z.infer<typeof RetrievalRequestSchema>;

export type RetrievedDocument = {
  id: string;
  title: string;
  relevance: number;
  content: string;
};

export type WorkflowStep = {
  name: string;
  service: string;
  status: "ok" | "error" | "blocked";
  durationMs: number;
  attributes: Record<string, string | number | boolean>;
};

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};

export type WorkflowResult = {
  traceId: string;
  status: "completed" | "failed" | "blocked";
  answer: string | null;
  failure: {
    category: string;
    service: string;
    step: string;
    message: string;
  } | null;
  steps: WorkflowStep[];
  usage: Usage;
  evaluation: {
    grounded: boolean;
    toolSucceeded: boolean;
    validationPassed: boolean;
    score: number;
  };
  metadata: {
    scenario: FailureScenario;
    promptVersion: string;
    model: string;
    retrievedDocumentIds: string[];
    replayOf?: string;
  };
};

export type ReplayRecord = {
  schemaVersion: "1.0";
  originalTraceId: string;
  recordedAt: string;
  request: WorkflowRequest;
  result: WorkflowResult;
  fixture: {
    retrievedDocuments: Array<Pick<RetrievedDocument, "id" | "title" | "relevance">>;
    answer: string | null;
  };
  privacy: {
    contentRedacted: boolean;
    secretFieldsRedacted: number;
  };
};

export type ReplayComparison = {
  originalTraceId: string;
  replayTraceId: string;
  mode: "fixture" | "live";
  changed: {
    status: boolean;
    answer: boolean;
    toolPath: boolean;
    validation: boolean;
  };
  original: WorkflowResult;
  replay: WorkflowResult;
};
