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

export type NodeObservabilityConfig = {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  namespace: string;
  instanceId: string;
  otlpEndpoint?: string;
  disabled?: boolean;
  metricExportIntervalMs?: number;
};

export type ObservabilityHandle = {
  enabled: boolean;
  shutdown(): Promise<void>;
};

export async function initializeNodeObservability(
  config: NodeObservabilityConfig,
): Promise<ObservabilityHandle> {
  if (config.disabled || !config.otlpEndpoint) {
    return { enabled: false, async shutdown() {} };
  }

  const base = config.otlpEndpoint.replace(/\/$/, "");
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: config.serviceVersion,
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: config.environment,
      "service.namespace": config.namespace,
      "service.instance.id": config.instanceId,
    }),
    traceExporter: new OTLPTraceExporter({ url: `${base}/v1/traces` }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${base}/v1/metrics` }),
      exportIntervalMillis: config.metricExportIntervalMs ?? 5_000,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  });

  sdk.start();
  return {
    enabled: true,
    async shutdown() {
      await sdk.shutdown();
    },
  };
}
