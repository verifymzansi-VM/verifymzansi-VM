/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { POST } from "./route";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { checkRateLimit, checkSensitiveActionRateLimit } from "@/lib/utils/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: () => ({}),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  checkSensitiveActionRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture" }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("Retired backend used");
  }),
}));
const staff = "11111111-1111-4111-8111-111111111111",
  requestId = "22222222-2222-4222-8222-222222222222",
  csrf = "c".repeat(64),
  rpc = vi.fn();
/** Datasets the live database exports: the registry entries of the committed
 * snapshot, which CI keeps in step with database/foundation/updates. */
const registryCount = [
  ...readFileSync(
    "database/foundation/current/functions/internal/frontend_privacy_export_data.sql",
    "utf8"
  ).matchAll(/^\s*\('[a-z_]+',\$q\$/gm),
].length;
/** `count` distinct dataset names of letters and underscores, each with one row. */
function datasets(count: number) {
  return Object.fromEntries(
    Array.from({ length: count }, (_, i) => [
      `set_${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`,
      [{ id: i }],
    ])
  );
}
function exported(found: boolean, count: number) {
  return {
    request_id: requestId,
    reference: "DSAR-22222222",
    generated_at: "2026-11-09T22:00:00Z",
    request_type: "access",
    received_at: "2026-11-01T08:00:00Z",
    due_by: "2026-12-01T08:00:00Z",
    account_found: found,
    datasets: datasets(count),
  };
}
function request() {
  return new NextRequest("https://verifymzansi.com/api/admin/dsar/export", {
    method: "POST",
    body: JSON.stringify({ requestId, revision: 4 }),
    headers: {
      origin: "https://verifymzansi.com",
      "content-type": "application/json",
      cookie: `vm_csrf=${csrf}`,
      "x-csrf-token": csrf,
    },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(checkSensitiveActionRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticateCaller: async () => ({ api: { rpc }, accountId: staff, sessionId: staff }),
    respond: (response: NextResponse) => response,
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
});
afterEach(() => vi.unstubAllEnvs());
it("downloads an export holding every dataset the database returns through one native command", async () => {
  rpc.mockResolvedValue({ data: exported(true, registryCount), error: null });
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Disposition")).toBe(
    'attachment; filename="dsar-export-22222222.json"'
  );
  const body = await response.json();
  expect(Object.keys(body.datasets)).toHaveLength(registryCount);
  expect(body.scope).toMatch(/^Account records in the listed datasets/);
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    "export_frontend_privacy_request",
    { p_case: requestId, p_revision: 4 },
    { get: false }
  );
  expect(checkSensitiveActionRateLimit).toHaveBeenCalledWith(staff, "admin:dsar:export");
  expect(createAdminClient).not.toHaveBeenCalled();
});
/** The route's FOUNDATION_EXPORT_DATASET_COUNT: the live database's datasets. */
const liveCount = 42;
it("refuses an export with fewer datasets than the live count instead of returning part of it", async () => {
  expect(registryCount).toBeGreaterThanOrEqual(liveCount);
  rpc.mockResolvedValueOnce({ data: exported(true, liveCount - 1), error: null });
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(await response.json()).not.toHaveProperty("datasets");
});
it("accepts more datasets than the live count, so an update can add one first", async () => {
  for (const count of [liveCount, liveCount + 1]) {
    rpc.mockResolvedValueOnce({ data: exported(true, count), error: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(Object.keys((await response.json()).datasets)).toHaveLength(count);
  }
});
it("returns no datasets when no account matches the request", async () => {
  rpc.mockResolvedValueOnce({ data: exported(false, 0), error: null });
  expect((await POST(request())).status).toBe(200);
  rpc.mockResolvedValueOnce({ data: exported(false, registryCount), error: null });
  expect((await POST(request())).status).toBe(503);
});
it("words the refusals for a request not in progress, the 5-export cap and a too large export", async () => {
  for (const [error, status, message] of [
    [
      { code: "PT409", details: "privacy_export_not_in_progress" },
      409,
      /^Only a request in progress/,
    ],
    [{ code: "PT429", details: "privacy_export_limit" }, 429, /exported 5 times/],
    [{ code: "PT413" }, 413, /too large/],
  ] as const) {
    rpc.mockResolvedValueOnce({ data: null, error });
    const response = await POST(request());
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body.error).toMatch(message);
    expect(body.error).toMatch(/Nothing was exported\.$/);
    expect(body).not.toHaveProperty("datasets");
  }
});
