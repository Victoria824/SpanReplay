import { startTelemetry } from "../telemetry/sdk.js";

const serviceName = process.env.SERVICE_NAME ?? "api-gateway";
await startTelemetry(serviceName);

const configuration = {
  "api-gateway": {
    port: Number(process.env.PORT ?? 4000),
    load: async () => (await import("../services/gateway/server.js")).buildGatewayServer(),
  },
  "agent-service": {
    port: Number(process.env.PORT ?? 4001),
    load: async () => (await import("../services/agent/server.js")).buildAgentServer(),
  },
  "retrieval-service": {
    port: Number(process.env.PORT ?? 4002),
    load: async () => (await import("../services/retrieval/server.js")).buildRetrievalServer(),
  },
} as const;

if (!(serviceName in configuration)) {
  throw new Error(`Unknown SERVICE_NAME: ${serviceName}`);
}

const selected = configuration[serviceName as keyof typeof configuration];
const app = await selected.load();
await app.listen({ port: selected.port, host: process.env.HOST ?? "0.0.0.0" });
