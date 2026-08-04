import { spawn, type ChildProcess } from "node:child_process";

const commands = [
  ["retrieval-service", "4002"],
  ["agent-service", "4001"],
  ["api-gateway", "4000"],
] as const;

const children: ChildProcess[] = commands.map(([service, port]) =>
  spawn(process.execPath, ["--import", "tsx", "src/bin/service.ts"], {
    stdio: "inherit",
    env: {
      ...process.env,
      SERVICE_NAME: service,
      PORT: port,
      OTEL_SDK_DISABLED: process.env.OTEL_SDK_DISABLED ?? "true",
      SPANREPLAY_REDACT_CONTENT: process.env.SPANREPLAY_REDACT_CONTENT ?? "true",
    },
  }),
);

function stop() {
  for (const child of children) child.kill("SIGTERM");
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
await Promise.all(children.map((child) => new Promise((resolve) => child.once("exit", resolve))));
