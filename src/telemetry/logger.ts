import pino from "pino";
import { trace } from "@opentelemetry/api";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: {
    service: process.env.SERVICE_NAME ?? "spanreplay",
    environment: process.env.DEPLOYMENT_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
  },
  redact: {
    paths: [
      "authorization",
      "headers.authorization",
      "apiKey",
      "api_key",
      "accessToken",
      "access_token",
      "password",
      "secret",
    ],
    censor: "[REDACTED]",
  },
  mixin() {
    const context = trace.getActiveSpan()?.spanContext();
    return context
      ? { trace_id: context.traceId, span_id: context.spanId, trace_flags: context.traceFlags }
      : {};
  },
});
