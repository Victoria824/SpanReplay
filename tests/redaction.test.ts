import { describe, expect, it } from "vitest";

import { redact } from "../src/privacy/redaction.js";

describe("replay redaction", () => {
  it("removes secrets and common personal identifiers recursively", () => {
    const result = redact({
      authorization: "Bearer top-secret-token",
      nested: {
        api_key: "sk-example-secret-value",
        message: "Contact operator@example.com with Bearer abc.def.ghi",
      },
    });

    expect(result.value.authorization).toBe("[REDACTED]");
    expect(result.value.nested.api_key).toBe("[REDACTED]");
    expect(result.value.nested.message).toContain("[REDACTED_EMAIL]");
    expect(result.value.nested.message).not.toContain("abc.def.ghi");
    expect(result.redactedFields).toBeGreaterThanOrEqual(3);
  });
});
