import { createCorrelatedLogger } from "../../packages/observability-sdk/src/index.js";

export const logger = createCorrelatedLogger({
  serviceName: process.env.SERVICE_NAME ?? "spanreplay",
  environment: process.env.DEPLOYMENT_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
  version: process.env.npm_package_version ?? "0.1.0",
  level: process.env.LOG_LEVEL ?? "info",
});
