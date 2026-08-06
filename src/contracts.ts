import { z } from "zod";

export const failureScenarios = [
  "healthy",
  "retrieval-timeout",
  "retrieval-saturation",
  "irrelevant-context",
  "provider-timeout",
  "tool-error",
  "error-tracking",
  "validation-failure",
  "cost-spike",
] as const;

export const FailureScenarioSchema = z.enum(failureScenarios);
export type FailureScenario = z.infer<typeof FailureScenarioSchema>;

export const WorkflowConfigVersionSchema = z.enum(["config-v1", "strict-v2"]);
export type WorkflowConfigVersion = z.infer<typeof WorkflowConfigVersionSchema>;

export const WorkflowRequestSchema = z.object({
  question: z.string().min(3).max(2_000),
  scenario: FailureScenarioSchema.default("healthy"),
  promptVersion: z.string().min(1).max(80).default("support-agent-v1"),
  model: z.string().min(1).max(120).default("deterministic-demo-model"),
  replayOf: z.string().regex(/^[a-f0-9]{32}$/).optional(),
  tenantId: z.string().min(1).max(120).optional(),
});

export type WorkflowRequest = z.infer<typeof WorkflowRequestSchema>;

export const RetrievalRequestSchema = z.object({
  query: z.string().min(1).max(2_000),
  scenario: FailureScenarioSchema,
});

export type RetrievalRequest = z.infer<typeof RetrievalRequestSchema>;

export const ReplayRequestSchema = z.object({
  mode: z.enum(["fixture", "live"]).default("fixture"),
  promptVersion: z.string().min(1).max(80).optional(),
  configVersion: WorkflowConfigVersionSchema.optional(),
  codeVersion: z.string().min(1).max(80).optional(),
  reason: z.string().trim().min(8).max(500).optional(),
  overrides: z.object({
    groundingThreshold: z.number().min(0).max(1).optional(),
    toolOutcome: z.enum(["recorded", "success", "failure"]).default("recorded"),
  }).optional(),
});

export type ReplayRequest = z.infer<typeof ReplayRequestSchema>;

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
    configVersion?: string;
    codeVersion?: string;
    groundingThreshold?: number;
  };
};

export type RecordedAdapterError = {
  name: string;
  message: string;
  category: string;
  service: string;
  step: string;
  statusCode: number;
};

export type RecordedAdapterCall<Input, Output> = {
  input: Input;
  outcome:
    | { ok: true; value: Output }
    | { ok: false; error: RecordedAdapterError };
};

export type RetrievalAdapterInput = {
  query: string;
  scenario: FailureScenario;
};

export type RetrievalAdapterOutput = {
  documents: RetrievedDocument[];
  durationMs: number;
};

export type ModelAttempt = "primary" | "retry" | "fallback";

export type ModelAdapterInput = {
  question: string;
  documents: RetrievedDocument[];
  scenario: FailureScenario;
  promptVersion: string;
  model: string;
  attempt: ModelAttempt;
};

export type ModelAdapterOutput = {
  answer: string;
  usage: Usage;
  provider: string;
  model: string;
};

export type ToolAdapterInput = {
  name: "incident.ticket.lookup";
  scenario: FailureScenario;
};

export type ToolAdapterOutput = {
  ticket: string;
};

export type ReplayFixture = {
  schemaVersion: "2.0";
  retrieval: Array<RecordedAdapterCall<RetrievalAdapterInput, RetrievalAdapterOutput>>;
  model: Array<RecordedAdapterCall<ModelAdapterInput, ModelAdapterOutput>>;
  tool: Array<RecordedAdapterCall<ToolAdapterInput, ToolAdapterOutput>>;
};

export type ReplayRecord = {
  schemaVersion: "2.0";
  originalTraceId: string;
  recordedAt: string;
  request: WorkflowRequest;
  result: WorkflowResult;
  fixture: ReplayFixture;
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
    cost: boolean;
    promptVersion: boolean;
    configVersion: boolean;
    codeVersion: boolean;
  };
  driftDetected: boolean;
  original: WorkflowResult;
  replay: WorkflowResult;
};
