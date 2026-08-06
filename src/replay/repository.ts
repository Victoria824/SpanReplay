import type { ReplayFixture, ReplayRecord, WorkflowRequest, WorkflowResult } from "../contracts.js";
import { redact, stripReplayContent } from "../privacy/redaction.js";

export interface ReplayRepository {
  save(request: WorkflowRequest, result: WorkflowResult, fixture: ReplayFixture): Promise<ReplayRecord>;
  get(traceId: string): Promise<ReplayRecord>;
  list(limit?: number): Promise<ReplayRecord[]>;
}

export const replayTraceIdPattern = /^[a-f0-9]{32}$/;

function sanitizeFixture(fixture: ReplayFixture, contentRedacted: boolean): ReplayFixture {
  const sanitized = structuredClone(fixture);
  if (!contentRedacted) return sanitized;

  for (const call of sanitized.retrieval) {
    call.input.query = "[CONTENT_REDACTED]";
    if (call.outcome.ok) {
      call.outcome.value.documents = call.outcome.value.documents.map((document) => ({
        ...document,
        content: "[CONTENT_REDACTED]",
      }));
    }
  }
  for (const call of sanitized.model) {
    call.input.question = "[CONTENT_REDACTED]";
    call.input.documents = call.input.documents.map((document) => ({
      ...document,
      content: "[CONTENT_REDACTED]",
    }));
    if (call.outcome.ok) call.outcome.value.answer = "[CONTENT_REDACTED]";
  }
  return sanitized;
}

export function createReplayRecord(
  request: WorkflowRequest,
  result: WorkflowResult,
  fixture: ReplayFixture,
): ReplayRecord {
  const contentRedacted = process.env.SPANREPLAY_REDACT_CONTENT !== "false";
  const strippedRequest = stripReplayContent({ ...request }) as WorkflowRequest;
  const strippedResult = structuredClone(result);
  if (contentRedacted && strippedResult.answer !== null) strippedResult.answer = "[CONTENT_REDACTED]";

  const candidate: ReplayRecord = {
    schemaVersion: "2.0",
    originalTraceId: result.traceId,
    recordedAt: new Date().toISOString(),
    request: strippedRequest,
    result: strippedResult,
    fixture: sanitizeFixture(fixture, contentRedacted),
    privacy: { contentRedacted, secretFieldsRedacted: 0 },
  };
  const sanitized = redact(candidate);
  sanitized.value.privacy.secretFieldsRedacted = sanitized.redactedFields;
  return sanitized.value;
}
