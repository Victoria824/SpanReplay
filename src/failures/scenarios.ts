import type { FailureScenario } from "../contracts.js";

export class InjectedFailure extends Error {
  constructor(
    message: string,
    readonly category: string,
    readonly service: string,
    readonly step: string,
    readonly statusCode = 503,
  ) {
    super(message);
    this.name = "InjectedFailure";
  }
}

export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function injectDelay(
  scenario: FailureScenario,
  target: "retrieval" | "provider",
): Promise<void> {
  if (scenario === `${target}-timeout`) {
    await delay(Number(process.env.FAILURE_DELAY_MS ?? 850));
    throw new InjectedFailure(
      `${target} dependency exceeded its timeout budget`,
      "dependency_timeout",
      target === "retrieval" ? "retrieval-service" : "agent-service",
      target,
      504,
    );
  }
}
