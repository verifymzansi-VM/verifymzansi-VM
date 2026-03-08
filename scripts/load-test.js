/**
 * k6 load test — VerifyMzansi critical paths
 *
 * Run:
 *   k6 run scripts/load-test.js
 *   k6 run scripts/load-test.js --env BASE_URL=https://staging.verifymzansi.com
 *
 * Scenarios:
 *   - smoke:   5 VUs × 30 s  (always passes)
 *   - average: 50 VUs × 60 s (normal traffic)
 *   - stress:  200 VUs × 120 s, ramp-down (peak traffic)
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3000";

// Custom metrics
const errorRate = new Rate("errors");
const homepageLatency = new Trend("homepage_latency", true);
const apiLatency = new Trend("api_latency", true);

export const options = {
  scenarios: {
    smoke: {
      executor: "constant-vus",
      vus: 5,
      duration: "30s",
      tags: { scenario: "smoke" },
    },
    average: {
      executor: "constant-vus",
      vus: 50,
      duration: "60s",
      startTime: "35s",
      tags: { scenario: "average" },
    },
    stress: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 200 },
        { duration: "60s", target: 200 },
        { duration: "30s", target: 0 },
      ],
      startTime: "100s",
      tags: { scenario: "stress" },
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<2000", "p(99)<5000"], // 95th < 2s, 99th < 5s
    errors: ["rate<0.05"],                            // < 5% error rate
    homepage_latency: ["p(95)<1500"],
    api_latency: ["p(95)<500"],
  },
};

export default function () {
  // ── Homepage ────────────────────────────────────────────
  const homeRes = http.get(`${BASE}/`);
  homepageLatency.add(homeRes.timings.duration);
  check(homeRes, {
    "homepage 200": (r) => r.status === 200,
    "homepage < 3s": (r) => r.timings.duration < 3000,
  }) || errorRate.add(1);

  sleep(1);

  // ── Health endpoint ─────────────────────────────────────
  const healthRes = http.get(`${BASE}/api/health`);
  apiLatency.add(healthRes.timings.duration);
  check(healthRes, {
    "health 200": (r) => r.status === 200,
    "health < 500ms": (r) => r.timings.duration < 500,
  }) || errorRate.add(1);

  sleep(0.5);

  // ── Marketplace pages ──────────────────────────────────
  const marketPages = ["/mzansi-market", "/business-ads", "/mall-shops"];
  const page = marketPages[Math.floor(Math.random() * marketPages.length)];
  const marketRes = http.get(`${BASE}${page}`);
  check(marketRes, {
    "marketplace 2xx": (r) => r.status >= 200 && r.status < 400,
    "marketplace < 3s": (r) => r.timings.duration < 3000,
  }) || errorRate.add(1);

  sleep(1);

  // ── Pricing page ──────────────────────────────────────
  const pricingRes = http.get(`${BASE}/pricing`);
  check(pricingRes, {
    "pricing 200": (r) => r.status === 200,
  }) || errorRate.add(1);

  sleep(0.5);

  // ── Login page (renders, no submission) ──────────────
  const loginRes = http.get(`${BASE}/login`);
  check(loginRes, {
    "login 200": (r) => r.status === 200,
  }) || errorRate.add(1);

  sleep(1);
}
