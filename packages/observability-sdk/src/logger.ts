import { trace } from "@opentelemetry/api";
import pino, { type Logger, type LoggerOptions } from "pino";

export type CorrelatedLoggerOptions = {
  serviceName: string;
  environment: string;
  level?: string;
  version?: string;
  additionalRedactPaths?: string[];
  pino?: LoggerOptions;
};

const defaultRedactPaths = [
  "authorization",
  "headers.authorization",
  "apiKey",
  "api_key",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "password",
  "secret",
  "cookie",
  "headers.cookie",
];

export function createCorrelatedLogger(options: CorrelatedLoggerOptions): Logger {
  return pino({
    ...options.pino,
    level: options.level ?? "info",
    base: {
      service: options.serviceName,
      environment: options.environment,
      ...(options.version ? { version: options.version } : {}),
      ...options.pino?.base,
    },
    redact: {
      paths: [...defaultRedactPaths, ...(options.additionalRedactPaths ?? [])],
      censor: "[REDACTED]",
    },
    mixin() {
      const context = trace.getActiveSpan()?.spanContext();
      return context
        ? { trace_id: context.traceId, span_id: context.spanId, trace_flags: context.traceFlags }
        : {};
    },
  });
}
