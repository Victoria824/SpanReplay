import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { ReplayFixture, ReplayRecord, WorkflowRequest, WorkflowResult } from "../contracts.js";
import { createReplayRecord, replayTraceIdPattern, type ReplayRepository } from "./repository.js";

export type S3ReplayRepositoryOptions = {
  bucket: string;
  prefix?: string;
  kmsKeyId?: string;
  client?: S3Client;
};

export class S3ReplayRepository implements ReplayRepository {
  private readonly client: S3Client;
  private readonly prefix: string;

  constructor(private readonly options: S3ReplayRepositoryOptions) {
    if (!options.bucket) throw new Error("S3 replay bucket is required");
    this.client = options.client ?? new S3Client({});
    this.prefix = `${(options.prefix ?? "replays").replace(/^\/+|\/+$/g, "")}/`;
  }

  private key(traceId: string): string {
    if (!replayTraceIdPattern.test(traceId)) throw new Error("Invalid trace id");
    return `${this.prefix}${traceId}.json`;
  }

  async save(request: WorkflowRequest, result: WorkflowResult, fixture: ReplayFixture): Promise<ReplayRecord> {
    const record = createReplayRecord(request, result, fixture);
    await this.client.send(new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: this.key(result.traceId),
      Body: `${JSON.stringify(record)}\n`,
      ContentType: "application/json",
      ServerSideEncryption: this.options.kmsKeyId ? "aws:kms" : "AES256",
      ...(this.options.kmsKeyId ? { SSEKMSKeyId: this.options.kmsKeyId } : {}),
    }));
    return record;
  }

  async get(traceId: string): Promise<ReplayRecord> {
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.options.bucket,
      Key: this.key(traceId),
    }));
    if (!response.Body) throw new Error("Replay record body is empty");
    return JSON.parse(await response.Body.transformToString()) as ReplayRecord;
  }

  async list(limit = 25): Promise<ReplayRecord[]> {
    const scanLimit = Number(process.env.REPLAY_S3_LIST_SCAN_LIMIT ?? 1_000);
    const contents: Array<{ Key?: string; LastModified?: Date }> = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.client.send(new ListObjectsV2Command({
        Bucket: this.options.bucket,
        Prefix: this.prefix,
        MaxKeys: Math.min(1_000, scanLimit - contents.length),
        ContinuationToken: continuationToken,
      }));
      contents.push(...(response.Contents ?? []));
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken && contents.length < scanLimit);

    const keys = contents
      .filter((item) => item.Key?.endsWith(".json"))
      .sort((a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0))
      .slice(0, Math.min(Math.max(limit, 1), 100))
      .map((item) => item.Key!.slice(this.prefix.length, -5));
    return Promise.all(keys.map((traceId) => this.get(traceId)));
  }
}

export function createReplayRepositoryFromEnv(): ReplayRepository {
  const backend = process.env.REPLAY_STORE_BACKEND ?? "filesystem";
  if (backend === "filesystem") {
    throw new Error("Filesystem replay repository must be constructed by the service loader");
  }
  if (backend !== "s3") throw new Error(`Unsupported REPLAY_STORE_BACKEND: ${backend}`);
  return new S3ReplayRepository({
    bucket: process.env.REPLAY_S3_BUCKET ?? "",
    prefix: process.env.REPLAY_S3_PREFIX,
    kmsKeyId: process.env.REPLAY_S3_KMS_KEY_ID,
  });
}
