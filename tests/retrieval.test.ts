import { afterEach, describe, expect, it, vi } from "vitest";

import { buildRetrievalServer } from "../src/services/retrieval/server.js";

afterEach(() => vi.unstubAllEnvs());

describe("retrieval service", () => {
  it("returns deterministic relevant runbooks", async () => {
    const app = buildRetrievalServer();
    const response = await app.inject({
      method: "POST",
      url: "/retrieve",
      payload: { query: "provider timeout", scenario: "healthy" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.documents).toHaveLength(3);
    expect(body.documents[0]).toMatchObject({ id: "runbook-provider-timeout", relevance: 0.96 });
    await app.close();
  });

  it("returns an intentionally irrelevant fixture for grounding-gate tests", async () => {
    const app = buildRetrievalServer();
    const response = await app.inject({
      method: "POST",
      url: "/retrieve",
      payload: { query: "provider timeout", scenario: "irrelevant-context" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().documents[0].relevance).toBeLessThan(0.7);
    await app.close();
  });

  it("exposes a controlled timeout as a dependency failure", async () => {
    vi.stubEnv("FAILURE_DELAY_MS", "1");
    const app = buildRetrievalServer();
    const response = await app.inject({
      method: "POST",
      url: "/retrieve",
      payload: { query: "provider timeout", scenario: "retrieval-timeout" },
    });

    expect(response.statusCode).toBe(504);
    expect(response.json().message).toContain("timeout budget");
    await app.close();
  });
});
