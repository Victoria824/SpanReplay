import { afterEach, describe, expect, it, vi } from "vitest";

import { buildRetrievalServer } from "../src/services/retrieval/server.js";

afterEach(() => vi.unstubAllEnvs());

describe("retrieval saturation experiment", () => {
  it("makes queueing visible while retaining successful responses", async () => {
    vi.stubEnv("SATURATION_BASE_DELAY_MS", "2");
    vi.stubEnv("SATURATION_QUEUE_DELAY_MS", "12");
    const app = buildRetrievalServer();

    const responses = await Promise.all(Array.from({ length: 8 }, () => app.inject({
      method: "POST",
      url: "/retrieve",
      payload: { query: "provider timeout", scenario: "retrieval-saturation" },
    })));
    const durations = responses.map((response) => response.json<{ durationMs: number }>().durationMs);

    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    expect(Math.max(...durations) - Math.min(...durations)).toBeGreaterThanOrEqual(30);
    await app.close();
  });

  it("sheds excess work at the configured safe concurrency boundary", async () => {
    vi.stubEnv("MAX_RETRIEVAL_CONCURRENCY", "4");
    vi.stubEnv("SATURATION_BASE_DELAY_MS", "25");
    const app = buildRetrievalServer();
    const responses = await Promise.all(Array.from({ length: 8 }, () => app.inject({
      method: "POST",
      url: "/retrieve",
      payload: { query: "provider timeout", scenario: "retrieval-saturation" },
    })));

    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(4);
    expect(responses.filter((response) => response.statusCode === 429)).toHaveLength(4);
    expect(responses.find((response) => response.statusCode === 429)?.headers["retry-after"]).toBe("1");
    await app.close();
  });
});
