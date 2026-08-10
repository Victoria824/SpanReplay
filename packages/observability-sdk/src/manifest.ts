export type ServiceObservabilityManifest = {
  schemaVersion: "1.0";
  service: { name: string; owner: string; tier: 1 | 2 | 3; runbook: string };
  signals: {
    traces: string[];
    metrics: Array<{ name: string; attributes: string[] }>;
    logs: { requiredFields: string[] };
    errors: { requiredFields: string[] };
  };
  slo: { objective: string; target: number; window: string };
};

const forbiddenMetricAttribute = /^(trace[._]?id|span[._]?id|user[._]?id|customer[._]?id|tenant[._]?id|request[._]?(text|body)|prompt([._].*)?|document[._]?id|exception[._]?message|error[._]?message|url[._]?full)$/i;
const requiredLogFields = ["service", "environment", "trace_id"];
const requiredErrorFields = ["error.type", "error.message", "error.stack", "error.fingerprint"];

export function validateServiceManifest(value: unknown): ServiceObservabilityManifest {
  if (!value || typeof value !== "object") throw new Error("manifest must be an object");
  const manifest = value as Partial<ServiceObservabilityManifest>;
  if (manifest.schemaVersion !== "1.0") throw new Error("schemaVersion must be 1.0");
  if (!manifest.service || !/^[a-z][a-z0-9-]+$/.test(manifest.service.name ?? "")) {
    throw new Error("service.name must be a stable kebab-case service name");
  }
  if (!manifest.service.owner?.trim()) throw new Error("service.owner is required");
  if (![1, 2, 3].includes(manifest.service.tier)) throw new Error("service.tier must be 1, 2, or 3");
  if (!manifest.service.runbook?.trim()) throw new Error("service.runbook is required");
  if (!manifest.signals?.traces?.length) throw new Error("at least one workflow or dependency span is required");
  for (const metric of manifest.signals.metrics ?? []) {
    if (!/^[a-z][a-z0-9_.]+$/.test(metric.name)) throw new Error(`invalid metric name ${metric.name}`);
    for (const attribute of metric.attributes) {
      if (forbiddenMetricAttribute.test(attribute)) {
        throw new Error(`metric ${metric.name} uses forbidden high-cardinality attribute ${attribute}`);
      }
    }
  }
  for (const field of requiredLogFields) {
    if (!manifest.signals.logs?.requiredFields.includes(field)) throw new Error(`logs must include ${field}`);
  }
  for (const field of requiredErrorFields) {
    if (!manifest.signals.errors?.requiredFields.includes(field)) throw new Error(`errors must include ${field}`);
  }
  if (!manifest.slo?.objective?.trim()) throw new Error("slo.objective is required");
  if (!(manifest.slo.target > 0 && manifest.slo.target <= 100)) throw new Error("slo.target must be in (0, 100]");
  if (!/^\d+[dhm]$/.test(manifest.slo.window)) throw new Error("slo.window must be a duration such as 30d");
  return manifest as ServiceObservabilityManifest;
}
