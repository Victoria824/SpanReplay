import type {
  RecordedAdapterCall,
  RecordedAdapterError,
  ReplayFixture,
  ToolAdapterOutput,
} from "../contracts.js";
import { InjectedFailure } from "../failures/scenarios.js";
import type { AgentAdapters } from "./types.js";

function serializeError(error: unknown): RecordedAdapterError {
  const injected = error instanceof InjectedFailure ? error : undefined;
  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
    category: injected?.category ?? "adapter_error",
    service: injected?.service ?? "unknown-service",
    step: injected?.step ?? "adapter",
    statusCode: injected?.statusCode ?? 500,
  };
}

function throwRecorded(error: RecordedAdapterError): never {
  throw new InjectedFailure(
    error.message,
    error.category,
    error.service,
    error.step,
    error.statusCode,
  );
}

async function record<Input, Output>(
  calls: Array<RecordedAdapterCall<Input, Output>>,
  input: Input,
  operation: () => Promise<Output>,
): Promise<Output> {
  try {
    const value = await operation();
    calls.push({ input: structuredClone(input), outcome: { ok: true, value: structuredClone(value) } });
    return value;
  } catch (error) {
    calls.push({ input: structuredClone(input), outcome: { ok: false, error: serializeError(error) } });
    throw error;
  }
}

export function createRecordingAdapters(base: AgentAdapters): {
  adapters: AgentAdapters;
  snapshot: () => ReplayFixture;
} {
  const fixture: ReplayFixture = {
    schemaVersion: "2.0",
    retrieval: [],
    model: [],
    tool: [],
  };
  return {
    adapters: {
      retrieval: {
        retrieve: (input) => record(fixture.retrieval, input, () => base.retrieval.retrieve(input)),
      },
      model: {
        invoke: (input) => record(fixture.model, input, () => base.model.invoke(input)),
      },
      tool: {
        execute: (input) => record(fixture.tool, input, () => base.tool.execute(input)),
      },
    },
    snapshot: () => structuredClone(fixture),
  };
}

type FixtureOverrides = {
  toolOutcome?: "recorded" | "success" | "failure";
};

function playback<Input, Output>(
  calls: Array<RecordedAdapterCall<Input, Output>>,
  adapterName: string,
): () => Output {
  let index = 0;
  return () => {
    const call = calls[index++];
    if (!call) throw new Error(`Replay fixture exhausted for ${adapterName} call ${index}`);
    if (!call.outcome.ok) return throwRecorded(call.outcome.error);
    return structuredClone(call.outcome.value);
  };
}

export function createFixtureAdapters(
  fixture: ReplayFixture,
  overrides: FixtureOverrides = {},
): AgentAdapters {
  const retrieve = playback(fixture.retrieval, "retrieval");
  const invoke = playback(fixture.model, "model");
  const execute = playback(fixture.tool, "tool");
  return {
    retrieval: { async retrieve() { return retrieve(); } },
    model: { async invoke() { return invoke(); } },
    tool: {
      async execute() {
        if (overrides.toolOutcome === "success") {
          return { ticket: "INC-REPLAY-OVERRIDE" } satisfies ToolAdapterOutput;
        }
        if (overrides.toolOutcome === "failure") {
          throw new InjectedFailure(
            "tool outcome overridden to failure during replay",
            "tool_dependency_error",
            "simulated-worker-boundary",
            "incident.ticket.lookup",
          );
        }
        return execute();
      },
    },
  };
}
