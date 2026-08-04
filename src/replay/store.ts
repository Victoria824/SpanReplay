import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ReplayRecord,
  RetrievedDocument,
  WorkflowRequest,
  WorkflowResult,
} from "../contracts.js";
import { redact, stripReplayContent } from "../privacy/redaction.js";

const TRACE_ID = /^[a-f0-9]{32}$/;

export class ReplayStore {
  constructor(private readonly directory = process.env.REPLAY_DIR ?? "./data/replays") {}

  private file(traceId: string): string {
    if (!TRACE_ID.test(traceId)) throw new Error("Invalid trace id");
    return path.join(this.directory, `${traceId}.json`);
  }

  async save(
    request: WorkflowRequest,
    result: WorkflowResult,
    retrievedDocuments: RetrievedDocument[],
  ): Promise<ReplayRecord> {
    await mkdir(this.directory, { recursive: true });
    const contentRedacted = process.env.SPANREPLAY_REDACT_CONTENT !== "false";
    const strippedRequest = stripReplayContent({ ...request }) as WorkflowRequest;
    const strippedResult = structuredClone(result);
    if (contentRedacted && strippedResult.answer !== null) {
      strippedResult.answer = "[CONTENT_REDACTED]";
    }
    const candidate: ReplayRecord = {
      schemaVersion: "1.0",
      originalTraceId: result.traceId,
      recordedAt: new Date().toISOString(),
      request: strippedRequest,
      result: strippedResult,
      fixture: {
        retrievedDocuments: retrievedDocuments.map(({ id, title, relevance }) => ({
          id,
          title,
          relevance,
        })),
        answer: contentRedacted && result.answer !== null ? "[CONTENT_REDACTED]" : result.answer,
      },
      privacy: {
        contentRedacted,
        secretFieldsRedacted: 0,
      },
    };
    const sanitized = redact(candidate);
    sanitized.value.privacy.secretFieldsRedacted = sanitized.redactedFields;
    const destination = this.file(result.traceId);
    const temporary = `${destination}.tmp`;
    await writeFile(temporary, `${JSON.stringify(sanitized.value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, destination);
    return sanitized.value;
  }

  async get(traceId: string): Promise<ReplayRecord> {
    return JSON.parse(await readFile(this.file(traceId), "utf8")) as ReplayRecord;
  }

  async list(limit = 25): Promise<ReplayRecord[]> {
    await mkdir(this.directory, { recursive: true });
    const files = (await readdir(this.directory))
      .filter((name) => /^[a-f0-9]{32}\.json$/.test(name));
    const records = await Promise.all(
      files.map(async (name) => JSON.parse(await readFile(path.join(this.directory, name), "utf8")) as ReplayRecord),
    );
    return records
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
      .slice(0, limit);
  }
}
