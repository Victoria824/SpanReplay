import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import type { ReplayFixture, ReplayRecord, WorkflowResult } from "../src/contracts.js";
import { S3ReplayRepository } from "../src/replay/s3-store.js";

describe("S3ReplayRepository", () => {
  it("writes encrypted replay evidence and reads it back by validated trace ID", async () => {
    let persisted = "";
    const sent: unknown[] = [];
    const client = {
      async send(command: unknown) {
        sent.push(command);
        if (command instanceof PutObjectCommand) {
          persisted = String(command.input.Body);
          return {};
        }
        if (command instanceof GetObjectCommand) {
          return { Body: { transformToString: async () => persisted } };
        }
        return { Contents: [] };
      },
    } as unknown as S3Client;
    const store = new S3ReplayRepository({
      bucket: "spanreplay-evidence",
      kmsKeyId: "alias/spanreplay",
      client,
    });
    const traceId = "e".repeat(32);
    const result: WorkflowResult = {
      traceId,
      status: "completed",
      answer: "safe answer",
      failure: null,
      steps: [],
      usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.00001 },
      evaluation: { grounded: true, toolSucceeded: true, validationPassed: true, score: 1 },
      metadata: { scenario: "healthy", promptVersion: "v1", model: "demo", retrievedDocumentIds: [] },
    };
    const fixture = { schemaVersion: "2.0", retrieval: [], model: [], tool: [] } satisfies ReplayFixture;

    await store.save(
      { question: "private", scenario: "healthy", promptVersion: "v1", model: "demo" },
      result,
      fixture,
    );
    const put = sent[0] as PutObjectCommand;
    expect(put.input).toMatchObject({
      Bucket: "spanreplay-evidence",
      Key: `replays/${traceId}.json`,
      ServerSideEncryption: "aws:kms",
      SSEKMSKeyId: "alias/spanreplay",
    });
    await expect(store.get(traceId)).resolves.toMatchObject({ originalTraceId: traceId });
    await expect(store.get("../unsafe")).rejects.toThrow("Invalid trace id");
  });

  it("paginates the scan and returns the newest records rather than lexicographic keys", async () => {
    const olderId = "f".repeat(32);
    const newerId = "1".repeat(32);
    const record = (traceId: string, recordedAt: string): ReplayRecord => ({
      schemaVersion: "2.0",
      originalTraceId: traceId,
      recordedAt,
      request: { question: "[CONTENT_REDACTED]", scenario: "healthy", promptVersion: "v1", model: "demo" },
      result: {
        traceId,
        status: "completed",
        answer: null,
        failure: null,
        steps: [],
        usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
        evaluation: { grounded: true, toolSucceeded: true, validationPassed: true, score: 1 },
        metadata: { scenario: "healthy", promptVersion: "v1", model: "demo", retrievedDocumentIds: [] },
      },
      fixture: { schemaVersion: "2.0", retrieval: [], model: [], tool: [] },
      privacy: { contentRedacted: true, secretFieldsRedacted: 0 },
    });
    const records = new Map([
      [olderId, record(olderId, "2026-08-01T00:00:00.000Z")],
      [newerId, record(newerId, "2026-08-02T00:00:00.000Z")],
    ]);
    let listPage = 0;
    const client = {
      async send(command: unknown) {
        if (command instanceof ListObjectsV2Command) {
          listPage += 1;
          return listPage === 1
            ? { Contents: [{ Key: `replays/${olderId}.json`, LastModified: new Date("2026-08-01") }], IsTruncated: true, NextContinuationToken: "next" }
            : { Contents: [{ Key: `replays/${newerId}.json`, LastModified: new Date("2026-08-02") }], IsTruncated: false };
        }
        if (command instanceof GetObjectCommand) {
          const traceId = command.input.Key!.slice("replays/".length, -".json".length);
          return { Body: { transformToString: async () => JSON.stringify(records.get(traceId)) } };
        }
        throw new Error("unexpected S3 command");
      },
    } as unknown as S3Client;

    const store = new S3ReplayRepository({ bucket: "spanreplay-evidence", client });
    const listed = await store.list(1);
    expect(listPage).toBe(2);
    expect(listed.map((item) => item.originalTraceId)).toEqual([newerId]);
  });
});
