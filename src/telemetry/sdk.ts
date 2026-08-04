import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

import { logger } from "./logger.js";

let sdk: NodeSDK | undefined;

export async function startTelemetry(serviceName: string): Promise<void> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint || process.env.OTEL_SDK_DISABLED === "true") {
    logger.warn("OTLP endpoint not configured; telemetry export is disabled");
    return;
  }

  const base = endpoint.replace(/\/$/, "");
  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? "0.1.0",
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]:
        process.env.DEPLOYMENT_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
      "service.namespace": "spanreplay",
      "service.instance.id": process.env.HOSTNAME ?? `${serviceName}-local`,
    }),
    traceExporter: new OTLPTraceExporter({ url: `${base}/v1/traces` }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${base}/v1/metrics` }),
      exportIntervalMillis: 5_000,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  });

  sdk.start();
  logger.info({ otlp_endpoint: base }, "OpenTelemetry SDK started");

  const shutdown = async () => {
    await sdk?.shutdown();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
