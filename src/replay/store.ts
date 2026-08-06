import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ReplayFixture,
  ReplayRecord,
  WorkflowRequest,
  WorkflowResult,
} from "../contracts.js";
import { createReplayRecord, replayTraceIdPattern, type ReplayRepository } from "./repository.js";

export class ReplayStore implements ReplayRepository {
  constructor(private readonly directory = process.env.REPLAY_DIR ?? "./data/replays") {}

  private file(traceId: string): string {
    if (!replayTraceIdPattern.test(traceId)) throw new Error("Invalid trace id");
    return path.join(this.directory, `${traceId}.json`);
  }

  async save(
    request: WorkflowRequest,
    result: WorkflowResult,
    fixture: ReplayFixture,
  ): Promise<ReplayRecord> {
    await mkdir(this.directory, { recursive: true });
    const record = createReplayRecord(request, result, fixture);
    const destination = this.file(result.traceId);
    const temporary = `${destination}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, destination);
    return record;
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
