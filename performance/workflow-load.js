import http from "k6/http";
import { check } from "k6";
import { Rate, Trend } from "k6/metrics";

const smoke = __ENV.SMOKE === "true";
const baseUrl = __ENV.BASE_URL || "http://127.0.0.1:4000";
const workflowLatency = new Trend("spanreplay_workflow_latency", true);
const workflowErrors = new Rate("spanreplay_workflow_errors");

export const options = {
  scenarios: {
    workflow_load: smoke
      ? { executor: "constant-vus", vus: 3, duration: "10s" }
      : {
          executor: "ramping-arrival-rate",
          startRate: 5,
          timeUnit: "1s",
          preAllocatedVUs: 20,
          maxVUs: 100,
          stages: [
            { target: 20, duration: "45s" },
            { target: 50, duration: "60s" },
            { target: 5, duration: "30s" },
          ],
        },
  },
  thresholds: {
    spanreplay_workflow_latency: ["p(95)<800", "p(99)<1500"],
    spanreplay_workflow_errors: ["rate<0.01"],
    http_req_failed: ["rate<0.01"],
  },
};

export default function () {
  const response = http.post(
    `${baseUrl}/api/workflows`,
    JSON.stringify({
      question: "How should we respond to a provider timeout?",
      scenario: "healthy",
    }),
    { headers: { "content-type": "application/json" } },
  );
  const valid = check(response, {
    "workflow completed": (result) => result.status === 200 && result.json("status") === "completed",
    "trace id returned": (result) => /^[a-f0-9]{32}$/.test(String(result.json("traceId"))),
  });
  workflowLatency.add(response.timings.duration);
  workflowErrors.add(!valid);
}
