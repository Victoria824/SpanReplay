import { useMemo, useState } from "react";

type Scenario =
  | "healthy"
  | "retrieval-timeout"
  | "retrieval-saturation"
  | "irrelevant-context"
  | "provider-timeout"
  | "tool-error"
  | "error-tracking"
  | "validation-failure"
  | "cost-spike";

type Step = {
  name: string;
  service: string;
  status: "ok" | "error" | "blocked";
  durationMs: number;
  attributes: Record<string, string | number | boolean>;
};

type Result = {
  traceId: string;
  status: "completed" | "failed" | "blocked";
  answer: string | null;
  failure: { category: string; service: string; step: string; message: string } | null;
  steps: Step[];
  usage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number };
  evaluation: { grounded: boolean; toolSucceeded: boolean; validationPassed: boolean; score: number };
  metadata: { scenario: Scenario; promptVersion: string; model: string; retrievedDocumentIds: string[] };
};

type Comparison = {
  mode: "fixture" | "live";
  originalTraceId: string;
  replayTraceId: string;
  changed: Record<string, boolean>;
  driftDetected: boolean;
  replay: Result;
};

const API = import.meta.env.VITE_API_URL || window.location.origin;

const scenarios: Array<{ value: Scenario; label: string; hint: string }> = [
  { value: "healthy", label: "Healthy workflow", hint: "Baseline: every dependency and policy passes" },
  { value: "retrieval-timeout", label: "Retrieval timeout", hint: "Dependency exceeds the retrieval latency budget" },
  { value: "retrieval-saturation", label: "Retrieval saturation", hint: "Concurrent requests create queueing delay in the retrieval boundary" },
  { value: "irrelevant-context", label: "Low relevance", hint: "Grounding gate blocks irrelevant context" },
  { value: "provider-timeout", label: "Provider timeout", hint: "The simulated model provider stops responding" },
  { value: "tool-error", label: "Tool failure", hint: "Incident ticket lookup returns a 503" },
  { value: "error-tracking", label: "Unhandled exception", hint: "A stable TypeError exercises backend error grouping" },
  { value: "validation-failure", label: "Unsafe response", hint: "Policy blocks a destructive action" },
  { value: "cost-spike", label: "Token cost spike", hint: "Usage jumps 12× while the workflow still succeeds" },
];

const seedResults: Record<Scenario, Result> = {
  healthy: {
    traceId: "6d7aa54e8de34792ab972bc8f66b517a",
    status: "completed",
    answer: "The incident runbook recommends one jittered retry, then a fallback model, while preserving the trace ID for escalation.",
    failure: null,
    steps: [
      { name: "retrieval.search", service: "retrieval-service", status: "ok", durationMs: 42, attributes: { documentCount: 3, topRelevance: 0.96 } },
      { name: "gen_ai.chat", service: "agent-service", status: "ok", durationMs: 186, attributes: { model: "deterministic-demo-model", inputTokens: 228, outputTokens: 92 } },
      { name: "incident.ticket.lookup", service: "simulated-worker-boundary", status: "ok", durationMs: 31, attributes: { attempts: 1 } },
    ],
    usage: { inputTokens: 228, outputTokens: 92, estimatedCostUsd: 0.00149 },
    evaluation: { grounded: true, toolSucceeded: true, validationPassed: true, score: 0.96 },
    metadata: { scenario: "healthy", promptVersion: "support-agent-v1", model: "deterministic-demo-model", retrievedDocumentIds: ["runbook-provider-timeout", "policy-retrieval-quality", "runbook-tool-failure"] },
  },
  "retrieval-timeout": null as unknown as Result,
  "retrieval-saturation": null as unknown as Result,
  "irrelevant-context": null as unknown as Result,
  "provider-timeout": null as unknown as Result,
  "tool-error": null as unknown as Result,
  "error-tracking": null as unknown as Result,
  "validation-failure": null as unknown as Result,
  "cost-spike": null as unknown as Result,
};

for (const [scenarioIndex, scenario] of scenarios.map((item) => item.value).filter((item) => item !== "healthy").entries()) {
  const base = structuredClone(seedResults.healthy);
  base.traceId = (scenarioIndex + 1).toString(16).repeat(32);
  base.metadata.scenario = scenario;
  if (scenario === "cost-spike") {
    base.usage = { inputTokens: 2736, outputTokens: 1104, estimatedCostUsd: 0.01788 };
  } else {
    base.status = scenario === "irrelevant-context" || scenario === "validation-failure" ? "blocked" : "failed";
    base.answer = null;
    base.failure = {
      category: scenario.includes("timeout") ? "dependency_timeout" : scenario.replaceAll("-", "_"),
      service: scenario.startsWith("retrieval") || scenario === "irrelevant-context" ? "retrieval-service" : "agent-service",
      step: scenario,
      message: scenarios.find((item) => item.value === scenario)?.hint ?? "Injected failure",
    };
    const last = base.steps.at(-1);
    if (last) last.status = base.status === "blocked" ? "blocked" : "error";
    base.evaluation.validationPassed = false;
    base.evaluation.score = 0.2;
  }
  seedResults[scenario] = base;
}

function statusLabel(status: Result["status"]) {
  return status === "completed" ? "HEALTHY" : status.toUpperCase();
}

export default function App() {
  const [scenario, setScenario] = useState<Scenario>("healthy");
  const [question, setQuestion] = useState("How should we respond when the primary LLM provider times out?");
  const [result, setResult] = useState<Result>(seedResults.healthy);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);

  const totalLatency = useMemo(
    () => result.steps.reduce((sum, step) => sum + step.durationMs, 0),
    [result],
  );

  async function run() {
    setLoading(true);
    setComparison(null);
    try {
      const response = await fetch(`${API}/api/workflows`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, scenario }),
      });
      if (!response.ok) throw new Error(`Gateway returned ${response.status}`);
      setResult((await response.json()) as Result);
      setConnected(true);
    } catch {
      setResult(seedResults[scenario]);
      setConnected(false);
    } finally {
      setLoading(false);
    }
  }

  async function replay() {
    setLoading(true);
    try {
      const response = await fetch(`${API}/api/replays/${result.traceId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "fixture" }),
      });
      if (!response.ok) throw new Error(`Replay returned ${response.status}`);
      setComparison((await response.json()) as Comparison);
    } catch {
      setComparison({
        mode: "fixture",
        originalTraceId: result.traceId,
        replayTraceId: "c".repeat(32),
        changed: { status: false, answer: false, toolPath: false, validation: false },
        driftDetected: false,
        replay: result,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <header>
        <a className="brand" href="#top"><span>S</span>SpanReplay <em>v0.1</em></a>
        <nav><a href="#trace">Trace</a><a href="#signals">Signals</a><a href="#replay">Replay</a><a href="https://github.com/Victoria824/SpanReplay" target="_blank" rel="noreferrer">GitHub ↗</a></nav>
      </header>

      <section className="hero" id="top">
        <div><p className="eyebrow">OpenTelemetry for production AI</p><h1>Find the failed step.<br/><span>Replay the evidence.</span></h1><p className="lede">A vendor-neutral observability reference stack for LLM and agent workflows—distributed traces, AI metrics, correlated logs, SLOs, and privacy-aware failure replay.</p></div>
        <div className="live"><i className={connected ? "on" : ""}/><span>{connected ? "LIVE SERVICES" : "ZERO-KEY PREVIEW"}</span><strong>OTLP READY</strong></div>
      </section>

      <section className="control">
        <label>Failure scenario<select value={scenario} onChange={(event) => setScenario(event.target.value as Scenario)}>{scenarios.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="question">Workflow request<input value={question} onChange={(event) => setQuestion(event.target.value)} /></label>
        <button onClick={run} disabled={loading}>{loading ? "Running…" : "Run workflow"}</button>
        <small>{scenarios.find((item) => item.value === scenario)?.hint}</small>
      </section>

      <section className="grid" id="trace">
        <article className="trace-card">
          <div className="card-head"><div><p>Distributed workflow trace</p><code>{result.traceId}</code></div><span className={`status ${result.status}`}>{statusLabel(result.status)}</span></div>
          <div className="waterfall">
            <div className="root"><span>api-gateway</span><strong>spanreplay.workflow</strong><time>{totalLatency + 18} ms</time></div>
            {result.steps.map((step, index) => <div className={`step ${step.status}`} key={`${step.name}-${index}`}><i/><span>{step.service}</span><strong>{step.name}</strong><time>{step.durationMs} ms</time><div style={{width: `${Math.max(18, Math.min(90, step.durationMs / Math.max(totalLatency, 1) * 100))}%`}}/></div>)}
          </div>
          {result.failure ? <div className="failure"><b>{result.failure.category}</b><span>{result.failure.service} / {result.failure.step}</span><p>{result.failure.message}</p></div> : <div className="answer"><b>Grounded response</b><p>{result.answer}</p></div>}
        </article>

        <aside id="signals">
          <article className="signals"><div className="card-head"><p>Correlated signals</p><span>trace_id linked</span></div><div className="metrics"><div><small>trace latency</small><strong>{totalLatency} ms</strong><em>observed workflow</em></div><div><small>estimated cost</small><strong>${result.usage.estimatedCostUsd.toFixed(5)}</strong><em>{result.usage.inputTokens + result.usage.outputTokens} tokens</em></div><div><small>grounding</small><strong>{Math.round(result.evaluation.score * 100)}%</strong><em>{result.evaluation.grounded ? "passed" : "blocked"}</em></div><div><small>tool path</small><strong>{result.steps.length}</strong><em>{result.evaluation.toolSucceeded ? "successful" : "incomplete"}</em></div></div></article>
          <article className="log"><div className="card-head"><p>Structured incident event</p><span>JSON / Pino</span></div><pre>{JSON.stringify({level: result.status === "completed" ? 30 : 50, service: result.failure?.service ?? "agent-service", trace_id: result.traceId, scenario: result.metadata.scenario, status: result.status, failure_category: result.failure?.category ?? null, prompt_version: result.metadata.promptVersion}, null, 2)}</pre></article>
        </aside>
      </section>

      <section className="replay" id="replay"><div><p className="eyebrow">Privacy-aware failure replay</p><h2>Turn an incident trace into a reproducible test.</h2><p>Re-execute the agent state machine with sanitized retrieval, model, and tool adapter fixtures. Compare status, tool path, validation, cost, and response changes.</p></div><button onClick={replay} disabled={loading}>Replay this trace</button>{comparison && <div className="diff"><span>ORIGINAL<br/><code>{comparison.originalTraceId.slice(0, 12)}…</code></span><b>→</b><span>REPLAYED<br/><code>{comparison.replayTraceId.slice(0, 12)}…</code></span><strong>{comparison.driftDetected ? "DRIFT DETECTED" : "REPRODUCED"}</strong></div>}</section>

      <footer><span>SpanReplay</span><p>OpenTelemetry · Node.js · TypeScript · Datadog-compatible · Apache-2.0</p></footer>
    </main>
  );
}
