import {
  initializeNodeObservability,
  type ObservabilityHandle,
} from "../../packages/observability-sdk/src/index.js";

import { logger } from "./logger.js";

let handle: ObservabilityHandle | undefined;

export async function startTelemetry(serviceName: string): Promise<void> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  handle = await initializeNodeObservability({
    serviceName,
    serviceVersion: process.env.npm_package_version ?? "0.1.0",
    environment: process.env.DEPLOYMENT_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    namespace: "spanreplay",
    instanceId: process.env.HOSTNAME ?? `${serviceName}-local`,
    otlpEndpoint: endpoint,
    disabled: process.env.OTEL_SDK_DISABLED === "true",
  });

  if (!handle.enabled) {
    logger.warn("OTLP endpoint not configured; telemetry export is disabled");
    return;
  }
  logger.info({ otlp_endpoint: endpoint }, "OpenTelemetry SDK started");

  const shutdown = async () => {
    await handle?.shutdown();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
