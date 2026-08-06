import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ReplayFixture, WorkflowResult } from "../src/contracts.js";
import { ReplayStore } from "../src/replay/store.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("ReplayStore", () => {
  it("rejects path-like identifiers and writes replay evidence with owner-only permissions", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "spanreplay-store-"));
    directories.push(directory);
    const traceId = "d".repeat(32);
    const store = new ReplayStore(directory);
    const result: WorkflowResult = {
      traceId,
      status: "blocked",
      answer: null,
      failure: { category: "policy_validation", service: "agent-service", step: "response.validate", message: "blocked" },
      steps: [],
      usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.00001 },
      evaluation: { grounded: true, toolSucceeded: false, validationPassed: false, score: 0.2 },
      metadata: {
        scenario: "validation-failure",
        promptVersion: "v1",
        model: "demo",
        retrievedDocumentIds: [],
      },
    };

    await store.save(
      { question: "private", scenario: "validation-failure", promptVersion: "v1", model: "demo" },
      result,
      {
        schemaVersion: "2.0",
        retrieval: [],
        model: [],
        tool: [],
      } satisfies ReplayFixture,
    );

    const file = await stat(path.join(directory, `${traceId}.json`));
    expect(file.mode & 0o777).toBe(0o600);
    await expect(store.get("../../etc/passwd")).rejects.toThrow("Invalid trace id");
  });
});
