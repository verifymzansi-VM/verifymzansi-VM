import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

type PerfScenario = {
  name: string;
  path: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  expectedStatuses: number[];
};

type PerfResult = {
  scenario: string;
  total: number;
  failures: number;
  p95Ms: number;
  avgMs: number;
};

const baseUrl =
  process.env.PERF_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "http://localhost:3000";

const requestCount = Number(process.env.PERF_REQUESTS ?? "60");
const concurrency = Number(process.env.PERF_CONCURRENCY ?? "6");
const p95ThresholdMs = Number(process.env.PERF_P95_MS ?? "1200");
const maxErrorRate = Number(process.env.PERF_MAX_ERROR_RATE ?? "0.01");

const scenarios: PerfScenario[] = [
  {
    name: "API health",
    path: "/api/health",
    expectedStatuses: [200],
  },
  {
    name: "Marketplace listing page",
    path: "/mzansi-market",
    expectedStatuses: [200],
  },
  {
    name: "PayFast webhook resilience",
    path: "/api/webhooks/payfast",
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "m_payment_id=perf-test&payment_status=COMPLETE&amount_gross=100.00",
    expectedStatuses: [400, 403, 404],
  },
];

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

async function runScenario(scenario: PerfScenario): Promise<PerfResult> {
  const latencies: number[] = [];
  let failures = 0;
  let completed = 0;

  async function executeOne(): Promise<void> {
    const url = `${baseUrl}${scenario.path}`;
    const started = performance.now();
    try {
      const res = await fetch(url, {
        method: scenario.method ?? "GET",
        headers: scenario.headers,
        body:
          typeof scenario.body === "string" || scenario.body === undefined
            ? scenario.body
            : JSON.stringify(scenario.body),
      });
      const elapsed = performance.now() - started;
      latencies.push(elapsed);

      if (!scenario.expectedStatuses.includes(res.status)) {
        failures += 1;
      }
    } catch {
      failures += 1;
      latencies.push(performance.now() - started);
    } finally {
      completed += 1;
    }
  }

  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, requestCount)) },
    async () => {
      while (nextIndex < requestCount) {
        nextIndex += 1;
        await executeOne();
      }
    }
  );

  await Promise.all(workers);

  const totalMs = latencies.reduce((sum, value) => sum + value, 0);
  const avgMs = latencies.length > 0 ? totalMs / latencies.length : 0;

  return {
    scenario: scenario.name,
    total: completed,
    failures,
    p95Ms: percentile(latencies, 95),
    avgMs,
  };
}

async function main(): Promise<void> {
  console.log("Running performance baseline checks...");
  console.log(
    `Target=${baseUrl} Requests=${requestCount} Concurrency=${concurrency} p95<=${p95ThresholdMs}ms ErrorRate<=${maxErrorRate}`
  );

  const results: PerfResult[] = [];
  for (const scenario of scenarios) {
    const result = await runScenario(scenario);
    results.push(result);
    const errorRate = result.total > 0 ? result.failures / result.total : 1;
    console.log(
      `  [RESULT] ${result.scenario}: total=${result.total} failures=${result.failures} errorRate=${errorRate.toFixed(
        3
      )} avg=${result.avgMs.toFixed(1)}ms p95=${result.p95Ms.toFixed(1)}ms`
    );
  }

  const failures: string[] = [];
  for (const result of results) {
    const errorRate = result.total > 0 ? result.failures / result.total : 1;
    if (errorRate > maxErrorRate) {
      failures.push(
        `${result.scenario} error rate ${errorRate.toFixed(3)} exceeded ${maxErrorRate}`
      );
    }
    if (result.p95Ms > p95ThresholdMs) {
      failures.push(
        `${result.scenario} p95 ${result.p95Ms.toFixed(1)}ms exceeded ${p95ThresholdMs}ms`
      );
    }
  }

  if (failures.length > 0) {
    console.error("Performance gate failed:");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }

  console.log("Performance baseline checks passed.");
}

main().catch((error) => {
  console.error("Performance check crashed:", error);
  process.exit(1);
});
