import { createServer } from "node:http";

import { trace } from "@opentelemetry/api";
import {
  createCorrelatedLogger,
  initializeNodeObservability,
} from "@spanreplay/observability-sdk";

const serviceName = "orders-service";
const observability = await initializeNodeObservability({
  serviceName,
  serviceVersion: "1.0.0",
  environment: process.env.DEPLOYMENT_ENVIRONMENT ?? "development",
  namespace: "commerce",
  instanceId: process.env.HOSTNAME ?? "orders-local",
  otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});
const logger = createCorrelatedLogger({
  serviceName,
  environment: process.env.DEPLOYMENT_ENVIRONMENT ?? "development",
  version: "1.0.0",
});
const tracer = trace.getTracer("orders-service");

const server = createServer((_request, response) => {
  tracer.startActiveSpan("orders.list", (span) => {
    logger.info({ order_count: 2 }, "orders listed");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ orders: ["ORDER-1", "ORDER-2"] }));
    span.end();
  });
});
server.listen(Number(process.env.PORT ?? 4010));

const shutdown = async () => {
  server.close();
  await observability.shutdown();
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
