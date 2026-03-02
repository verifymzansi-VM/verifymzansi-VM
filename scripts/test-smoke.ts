import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

type SmokeCheck = {
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

const checks: SmokeCheck[] = [
  {
    name: "Homepage",
    path: "/",
    expectStatuses: [200],
  },
  {
    name: "Health endpoint",
    path: "/api/health",
    expectStatuses: [200],
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
    name: "PayFast webhook path reachable",
    path: "/api/webhooks/payfast",
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "m_payment_id=test&payment_status=COMPLETE",
    expectStatuses: [400, 403, 404],
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

async function runCheck(check: SmokeCheck): Promise<void> {
  const url = `${baseUrl}${check.path}`;
  const method = check.method ?? "GET";
  const response = await fetch(url, {
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

main().catch((error) => {
  console.error("Smoke checks failed:", error);
  process.exit(1);
});
