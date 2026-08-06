# Production AI instrumentation standard

This standard keeps traces, metrics, and logs consistent across agent teams while preserving backend portability.

## Required resource attributes

| Attribute | Example | Rule |
| --- | --- | --- |
| `service.name` | `agent-service` | Stable deployable component name |
| `service.version` | `0.1.0` | Release or image version |
| `deployment.environment.name` | `production` | `local`, `staging`, or `production` |
| `service.namespace` | `spanreplay` | Owning platform or product boundary |
| `service.instance.id` | container/host ID | Trace-only; never aggregate as a metric tag |

## Required spans

| Operation | Span name | Required attributes |
| --- | --- | --- |
| Agent invocation | `invoke_agent <agent>` | `gen_ai.operation.name`, `gen_ai.agent.name`, `gen_ai.request.model`, `ai.prompt.version` |
| Retrieval | `retrieval.search` | peer service, result count, relevance in metric signal |
| Model call | `chat <model>` | provider, model, input/output token use |
| Tool call | `execute_tool <tool>` | tool name and outcome; omit payloads |
| Replay | `replay_workflow <mode>` | replay mode and original trace ID |

Record exceptions on the smallest responsible span and propagate the error status to the workflow span. Do not create one span per token or per retrieved chunk.

## Metric catalog

| Metric | Type | Low-cardinality dimensions |
| --- | --- | --- |
| `ai.workflow.duration` | histogram, ms | status, scenario |
| `ai.workflow.runs` | counter | status, scenario |
| `gen_ai.client.token.usage` | counter | token type, model, provider |
| `ai.workflow.estimated.cost` | counter, USD | model |
| `ai.retrieval.relevance` | histogram | outcome |
| `ai.retrieval.concurrency` | histogram | bounded mode |
| `ai.retrieval.admissions` | counter | admitted or shed |
| `ai.tool.calls` | counter | tool name, outcome |
| `ai.validation.failures` | counter | bounded reason enum |
| `ai.replay.runs` | counter | mode, outcome |
| `ai.agent.steps` | histogram | workflow status |
| `ai.agent.retries` | counter | dependency name |
| `ai.agent.fallbacks` | counter | fallback target |
| `ai.grounding.outcomes` | counter | passed or blocked |

Never use user ID, request text, trace ID, document ID, SQL, URL, exception message, or arbitrary model output as a metric dimension.

## Structured logs

Required keys: timestamp, severity, service, environment, message, trace ID when active, and a bounded failure category for incidents. Prompt version may be logged; prompt content may not. Sensitive errors must be normalized before logging.

## Sampling

- Keep all failed and policy-blocked traces.
- Keep all replay traces.
- Head-sample a configurable fraction of healthy traffic at the collector.
- Prefer tail sampling when the backend and traffic volume justify it.
- Retention for replay fixtures should be shorter than aggregate metrics and explicitly configured.
