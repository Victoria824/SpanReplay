import http from "k6/http";
import { check } from "k6";
import { Rate, Trend } from "k6/metrics";

const smoke = __ENV.SMOKE === "true";
const retrievalUrl = __ENV.RETRIEVAL_URL || "http://127.0.0.1:4002";
const retrievalLatency = new Trend("spanreplay_retrieval_saturation_latency", true);
const retrievalErrors = new Rate("spanreplay_retrieval_errors");

export const options = {
  scenarios: {
    retrieval_saturation: {
      executor: "constant-vus",
      vus: smoke ? 8 : 40,
      duration: smoke ? "10s" : "90s",
    },
  },
  thresholds: {
    spanreplay_retrieval_saturation_latency: ["p(95)<1200"],
    spanreplay_retrieval_errors: ["rate<0.01"],
  },
};

export default function () {
  const response = http.post(
    `${retrievalUrl}/retrieve`,
    JSON.stringify({ query: "provider timeout", scenario: "retrieval-saturation" }),
    { headers: { "content-type": "application/json" } },
  );
  const valid = check(response, {
    "retrieval succeeds": (result) => result.status === 200,
    "runbook returned": (result) => result.json("documents.0.id") === "runbook-provider-timeout",
  });
  retrievalLatency.add(response.timings.duration);
  retrievalErrors.add(!valid);
}
