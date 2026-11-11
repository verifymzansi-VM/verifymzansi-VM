/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST } from "../../reports/route";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import { verifyPublicTurnstile } from "@/lib/utils/public-mutation-route";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: () => ({}),
}));
vi.mock("@/lib/foundation/service-api", () => ({ createFoundationServiceApi: vi.fn() }));
vi.mock("@/lib/utils/public-mutation-route", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  verifyPublicTurnstile: vi.fn(),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientIp: () => "192.0.2.30",
  getClientRateLimitIdentity: () => ({ key: "fixture" }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("Retired reports table used");
  }),
}));
const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const rpc = vi.fn(),
  authenticateCaller = vi.fn(),
  csrf = "c".repeat(64);
const input = () => ({
  targetId: id(1),
  targetType: "listing",
  reason: "fake_listing",
  description: "a".repeat(2000),
  turnstileToken: "synthetic-captcha",
});
function request(body: unknown = input(), valid = true) {
  return new NextRequest("https://verifymzansi.com/api/reports", {
    method: "POST",
    headers: {
      origin: "https://verifymzansi.com",
      "content-type": "application/json",
      cookie: `vm_csrf=${csrf}`,
      ...(valid ? { "x-csrf-token": csrf } : {}),
    },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.stubEnv("IP_HASH_SECRET", "h".repeat(64));
  authenticateCaller.mockResolvedValue({ accountId: id(2) });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticateCaller,
    respond: (response: NextResponse) => response,
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
  vi.mocked(createFoundationServiceApi).mockReturnValue({ rpc } as unknown as ReturnType<
    typeof createFoundationServiceApi
  >);
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(verifyPublicTurnstile).mockResolvedValue(null);
  rpc.mockResolvedValue({ data: { id: id(3), status: "open" }, error: null });
});
afterEach(() => vi.unstubAllEnvs());
it("uses the native service command with the exact selected reason, represented target kind and full description", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true });
  expect(rpc).toHaveBeenCalledExactlyOnceWith("submit_frontend_report", {
    p_post_id: id(1),
    p_kind: "listing",
    p_reason: "fake_listing",
    p_description: "a".repeat(2000),
    p_reporter_id: id(2),
    p_reporter_ip_hmac: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
  });
  expect(createAdminClient).not.toHaveBeenCalled();
});
it("allows a genuine anonymous reporter but refuses an unavailable authentication check", async () => {
  authenticateCaller.mockRejectedValueOnce(new FoundationSessionError(401));
  expect((await POST(request())).status).toBe(200);
  expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_reporter_id");
  rpc.mockClear();
  authenticateCaller.mockRejectedValueOnce(new FoundationSessionError(503));
  expect((await POST(request())).status).toBe(503);
  expect(rpc).not.toHaveBeenCalled();
});
it("refuses supplied reporter authority, unsupported attachments, oversize text and missing CSRF before submission", async () => {
  for (const body of [
    { ...input(), reporterId: id(4) },
    { ...input(), evidenceUrls: ["https://example.com/evidence"] },
    { ...input(), description: "a".repeat(2001) },
  ])
    expect((await POST(request(body))).status).toBe(400);
  expect((await POST(request(input(), false))).status).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});
it("keeps CAPTCHA and degraded protection failures from reaching SQL", async () => {
  vi.mocked(verifyPublicTurnstile).mockResolvedValueOnce(
    NextResponse.json({ error: "CAPTCHA required" }, { status: 403 })
  );
  expect((await POST(request())).status).toBe(403);
  vi.mocked(checkRateLimit).mockResolvedValueOnce({ limited: false, degraded: true });
  expect((await POST(request())).status).toBe(503);
  expect(rpc).not.toHaveBeenCalled();
});
it("reports a duplicate clearly and treats malformed acknowledgements as unconfirmed without replay", async () => {
  rpc.mockResolvedValueOnce({ data: null, error: { code: "PT409" } });
  const duplicate = await POST(request());
  expect(duplicate.status).toBe(409);
  expect(await duplicate.json()).toMatchObject({
    error: expect.stringContaining("already reported"),
  });
  rpc.mockResolvedValueOnce({ data: { status: "open" }, error: null });
  expect((await POST(request())).status).toBe(503);
  expect(rpc).toHaveBeenCalledTimes(2);
});
