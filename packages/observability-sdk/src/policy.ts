import type { Attributes } from "@opentelemetry/api";

export type MetricAttributePolicy = Readonly<Record<string, readonly string[]>>;

const forbiddenKey = /^(trace[._]?id|span[._]?id|user[._]?id|customer[._]?id|request[._]?(text|body)|prompt([._].*)?|document[._]?id|exception[._]?message|error[._]?message|url[._]?full)$/i;

export function enforceMetricAttributePolicy(
  metricName: string,
  attributes: Attributes,
  policy: MetricAttributePolicy,
): Attributes {
  const allowed = policy[metricName];
  if (!allowed) throw new Error(`Metric ${metricName} is not registered in the attribute policy`);
  for (const key of Object.keys(attributes)) {
    if (forbiddenKey.test(key)) {
      throw new Error(`Metric ${metricName} uses forbidden high-cardinality attribute ${key}`);
    }
    if (!allowed.includes(key)) {
      throw new Error(`Metric ${metricName} uses unapproved attribute ${key}`);
    }
  }
  return attributes;
}
