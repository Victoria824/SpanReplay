const SECRET_KEY = /(authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|cookie)/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const API_KEY = /\b(?:sk|key|token)[-_][A-Za-z0-9_-]{12,}\b/gi;

export type RedactionResult<T> = {
  value: T;
  redactedFields: number;
};

function redactString(value: string): string {
  return value
    .replace(EMAIL, "[REDACTED_EMAIL]")
    .replace(BEARER, "Bearer [REDACTED]")
    .replace(API_KEY, "[REDACTED_SECRET]");
}

export function redact<T>(input: T): RedactionResult<T> {
  let redactedFields = 0;

  function visit(value: unknown, key = ""): unknown {
    if (SECRET_KEY.test(key)) {
      redactedFields += 1;
      return "[REDACTED]";
    }
    if (typeof value === "string") {
      const next = redactString(value);
      if (next !== value) redactedFields += 1;
      return next;
    }
    if (Array.isArray(value)) return value.map((item) => visit(item));
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([childKey, child]) => [childKey, visit(child, childKey)]),
      );
    }
    return value;
  }

  return { value: visit(input) as T, redactedFields };
}

export function stripReplayContent<T extends Record<string, unknown>>(input: T): T {
  if (process.env.SPANREPLAY_REDACT_CONTENT === "false") return input;
  const clone = structuredClone(input);
  const mutable = clone as Record<string, unknown>;
  if ("question" in mutable) mutable.question = "[CONTENT_REDACTED]";
  return clone;
}
