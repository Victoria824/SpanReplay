import { describe, expect, it } from "vitest";

import { enforceMetricAttributePolicy, errorTelemetryFields } from "../packages/observability-sdk/src/index.js";
import { metricAttributePolicy } from "../src/telemetry/signals.js";

describe("metric attribute governance", () => {
  it("accepts the registered bounded dimensions", () => {
    expect(enforceMetricAttributePolicy(
      "ai.workflow.runs",
      { "workflow.status": "completed", "failure.scenario": "healthy" },
      metricAttributePolicy,
    )).toEqual({ "workflow.status": "completed", "failure.scenario": "healthy" });
  });

  it("rejects unapproved and high-cardinality dimensions", () => {
    expect(() => enforceMetricAttributePolicy(
      "ai.workflow.runs",
      { trace_id: "a".repeat(32) },
      metricAttributePolicy,
    )).toThrow("forbidden high-cardinality attribute trace_id");
    expect(() => enforceMetricAttributePolicy(
      "ai.workflow.runs",
      { region: "ca-central-1" },
      metricAttributePolicy,
    )).toThrow("unapproved attribute region");
  });
});

describe("error tracking contract", () => {
  it("emits the normalized grouping fields without leaking common secrets", () => {
    const error = new TypeError("request for alice@example.com used Bearer secret-token");
    const fields = errorTelemetryFields(error, "ticket-parser");

    expect(fields["error.type"]).toBe("TypeError");
    expect(fields["error.message"]).toBe("request for [REDACTED] used [REDACTED]");
    expect(fields["error.stack"]).not.toContain("alice@example.com");
    expect(fields["error.fingerprint"]).toBe("ticket-parser");
  });
});
