import { describe, expect, it } from "vitest";

import { validateServiceManifest } from "../packages/observability-sdk/src/index.js";

const validManifest = () => ({
  schemaVersion: "1.0",
  service: { name: "orders-service", owner: "commerce", tier: 2, runbook: "https://runbook" },
  signals: {
    traces: ["orders.list"],
    metrics: [{ name: "orders.requests", attributes: ["operation", "outcome"] }],
    logs: { requiredFields: ["service", "environment", "trace_id"] },
    errors: { requiredFields: ["error.type", "error.message", "error.stack", "error.fingerprint"] },
  },
  slo: { objective: "availability", target: 99.9, window: "30d" },
});

describe("service instrumentation manifest", () => {
  it("accepts a complete owned service contract", () => {
    expect(validateServiceManifest(validManifest()).service.name).toBe("orders-service");
  });

  it("rejects high-cardinality metric dimensions", () => {
    const manifest = validManifest();
    manifest.signals.metrics[0]!.attributes.push("customer_id");
    expect(() => validateServiceManifest(manifest)).toThrow("forbidden high-cardinality attribute customer_id");
  });

  it("rejects missing Error Tracking normalization", () => {
    const manifest = validManifest();
    manifest.signals.errors.requiredFields = ["error.type"];
    expect(() => validateServiceManifest(manifest)).toThrow("errors must include error.message");
  });
});
