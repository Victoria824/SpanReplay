import type {
  ModelAdapterInput,
  ModelAdapterOutput,
  RetrievalAdapterInput,
  RetrievalAdapterOutput,
  ToolAdapterInput,
  ToolAdapterOutput,
} from "../contracts.js";

export interface RetrievalAdapter {
  retrieve(input: RetrievalAdapterInput): Promise<RetrievalAdapterOutput>;
}

export interface ModelAdapter {
  invoke(input: ModelAdapterInput): Promise<ModelAdapterOutput>;
}

export interface ToolAdapter {
  execute(input: ToolAdapterInput): Promise<ToolAdapterOutput>;
}

export type AgentAdapters = {
  retrieval: RetrievalAdapter;
  model: ModelAdapter;
  tool: ToolAdapter;
};
