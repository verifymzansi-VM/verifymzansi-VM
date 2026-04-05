/* eslint-disable no-console */
import { pathToFileURL } from "node:url";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

export type SmokeCheck = {
  name: string;
  path: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  expectStatuses: number[];
  validateJsonStatusKey?: boolean;
};

const baseUrl =
  process.env.SMOKE_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const checks: SmokeCheck[] = [
  {
    name: "Homepage",
    path: "/",
    expectStatuses: [200],
  },
  {
    name: "Health endpoint",
    path: "/api/health",
    // Health returns 503 when launch checks are degraded.
    expectStatuses: [200, 503],
    validateJsonStatusKey: true,
  },
  {
    name: "Login page",
    path: "/login",
    expectStatuses: [200],
  },
  {
    name: "Pricing page",
    path: "/pricing",
    expectStatuses: [200],
  },
  {
    name: "Marketplace page",
    path: "/mzansi-market",
    expectStatuses: [200],
  },
  {
    name: "Checkout initialization path (no auth)",
    path: "/api/billing/create-checkout",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: { area: "MZANSI_MARKET", tier: "starter" },
    expectStatuses: [400, 401, 403, 422],
  },
  {
    name: "Ozow webhook path reachable",
    path: "/api/webhooks/ozow",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ merchantReference: "test", eventType: "transaction.complete" }),
    expectStatuses: [400, 401, 403, 404],
  },
  {
    name: "KYC webhook path reachable",
    path: "/api/webhooks/kyc/provider",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: { provider_ref: "unknown-smoke-ref", status: "approved" },
    expectStatuses: [200, 401, 503],
  },
];

export async function runCheck(
  check: SmokeCheck,
  options?: {
    baseUrl?: string;
    fetchImpl?: typeof fetch;
  }
): Promise<void> {
  const resolvedBaseUrl = options?.baseUrl ?? baseUrl;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const url = `${resolvedBaseUrl}${check.path}`;
  const method = check.method ?? "GET";
  const response = await fetchImpl(url, {
    method,
    headers: check.headers,
    body:
      typeof check.body === "string" || check.body === undefined
        ? check.body
        : JSON.stringify(check.body),
  });

  if (!check.expectStatuses.includes(response.status)) {
    throw new Error(
      `${check.name} failed with status ${response.status}; expected one of ${check.expectStatuses.join(
        ", "
      )}`
    );
  }

  if (check.validateJsonStatusKey) {
    const json = (await response.json()) as { status?: string };
    if (!json.status) {
      throw new Error(`${check.name} missing 'status' key in JSON response`);
    }
  }

  console.log(`  [OK] ${check.name} (${response.status})`);
}

async function main(): Promise<void> {
  console.log("Running smoke checks...");
  console.log(`Target base URL: ${baseUrl}`);

  for (const check of checks) {
    await runCheck(check);
  }

  console.log("Smoke checks passed.");
}

const isMainModule =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv.length > 1 &&
  import.meta.url === pathToFileURL(process.argv[1]!).href;

if (isMainModule) {
  main().catch((error) => {
    console.error("Smoke checks failed:", error);
    process.exit(1);
  });
}
