/** @vitest-environment node */
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
it("downloads an export holding all 33 datasets through one native command", async () => {
  rpc.mockResolvedValue({ data: exported(true, 33), error: null });
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Disposition")).toBe(
    'attachment; filename="dsar-export-22222222.json"'
  );
  const body = await response.json();
  expect(Object.keys(body.datasets)).toHaveLength(33);
  expect(body.scope).toMatch(/^Account records in the listed datasets/);
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    "export_frontend_privacy_request",
    { p_case: requestId, p_revision: 4 },
    { get: false }
  );
  expect(checkSensitiveActionRateLimit).toHaveBeenCalledWith(staff, "admin:dsar:export");
  expect(createAdminClient).not.toHaveBeenCalled();
});
it("refuses an export with any other number of datasets instead of returning part of it", async () => {
  for (const count of [32, 34]) {
    rpc.mockResolvedValueOnce({ data: exported(true, count), error: null });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("datasets");
  }
});
it("returns no datasets when no account matches the request", async () => {
  rpc.mockResolvedValueOnce({ data: exported(false, 0), error: null });
  expect((await POST(request())).status).toBe(200);
  rpc.mockResolvedValueOnce({ data: exported(false, 33), error: null });
  expect((await POST(request())).status).toBe(503);
});
