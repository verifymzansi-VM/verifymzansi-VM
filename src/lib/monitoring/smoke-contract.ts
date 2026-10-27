export type SmokeCheck = {
  name: string;
  path: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  expectStatuses: number[];
  validateJsonStatusKey?: boolean;
};

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
  { name: "Business page", path: "/mzansi-business", expectStatuses: [200] },
  { name: "Tourism and events page", path: "/tourism-events", expectStatuses: [200] },
  { name: "Advertising page", path: "/advertise", expectStatuses: [200] },
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
    expectStatuses: [400, 401, 403, 404, 503],
  },
];
