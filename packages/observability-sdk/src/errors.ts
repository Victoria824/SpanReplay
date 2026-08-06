import type { Span } from "@opentelemetry/api";

const sensitivePatterns = [
  /bearer\s+[a-z0-9._~+/=-]+/gi,
  /\b(?:sk|pk)_(?:live|test)_[a-z0-9_-]+\b/gi,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
];

function sanitize(value: string): string {
  return sensitivePatterns.reduce((current, pattern) => current.replace(pattern, "[REDACTED]"), value);
}

export type ErrorTelemetryFields = {
  "error.type": string;
  "error.message": string;
  "error.stack": string;
  "error.fingerprint": string;
};

export function errorTelemetryFields(error: unknown, fingerprint?: string): ErrorTelemetryFields {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const type = normalized.name || "Error";
  const message = sanitize(normalized.message || String(error));
  const stack = sanitize(normalized.stack ?? `${type}: ${message}\n    at unknown`);

  return {
    "error.type": type,
    "error.message": message,
    "error.stack": stack,
    "error.fingerprint": fingerprint ?? type,
  };
}

export function recordErrorForTracking(span: Span, error: unknown, fingerprint?: string): void {
  const fields = errorTelemetryFields(error, fingerprint);
  span.recordException({
    name: fields["error.type"],
    message: fields["error.message"],
    stack: fields["error.stack"],
  });
  span.setAttributes(fields);
}

export function errorLogFields(error: unknown, fingerprint?: string) {
  const fields = errorTelemetryFields(error, fingerprint);
  return {
    error: {
      type: fields["error.type"],
      message: fields["error.message"],
      stack: fields["error.stack"],
      fingerprint: fields["error.fingerprint"],
    },
  };
}
