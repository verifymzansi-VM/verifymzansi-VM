/** @vitest-environment node */
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { GET, PATCH, POST } from "./route";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import { verifyPublicTurnstile } from "@/lib/utils/public-mutation-route";
import { checkRateLimit } from "@/lib/utils/rate-limit";

vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: vi.fn(),
}));
vi.mock("@/lib/foundation/service-api", () => ({ createFoundationServiceApi: vi.fn() }));
vi.mock("@/lib/utils/public-mutation-route", () => ({ verifyPublicTurnstile: vi.fn() }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "synthetic-ip" }),
}));
const account = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const post = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const token = "a".repeat(64);
const rpc = vi.fn(),
  service = vi.fn(),
  authenticateCaller = vi.fn();
const enquiry = {
  request_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  post_id: post,
  buyer_email: "buyer@example.org",
  message: "Is this still available?",
  turnstile_token: "synthetic-turnstile",
};
function request(
  method: string,
  body?: unknown,
  { origin = "https://verifymzansi.com", csrf = true, query = "" } = {}
) {
  return new NextRequest(
    "https://verifymzansi.com/api/foundation/enquiries" + query,
    body === undefined
      ? { method }
      : {
          method,
          body: JSON.stringify(body),
          headers: {
            "Content-Type": "application/json",
            origin,
            ...(csrf ? { cookie: `vm_csrf=${token}`, "x-csrf-token": token } : {}),
          },
        }
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readFoundationRuntimeConnection).mockReturnValue({
    url: "https://gntzjtuncsyefujajmjy.supabase.co",
    expectedProjectRef: "gntzjtuncsyefujajmjy",
    publishableKey: "sb_publishable_synthetic",
  });
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(verifyPublicTurnstile).mockResolvedValue(null);
  service.mockResolvedValue({ data: { id: account, reused: false }, error: null });
  vi.mocked(createFoundationServiceApi).mockReturnValue({ rpc: service } as never);
  authenticateCaller.mockRejectedValue(new FoundationSessionError(401));
  rpc.mockResolvedValue({ data: { items: [], unread_count: 0, next_cursor: null }, error: null });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate: async () => ({ rpc }),
    authenticateCaller,
    respond: async (response: NextResponse) => {
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    },
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
});

it("submits a signed-out enquiry once with no sender and no owner details returned", async () => {
  const response = await POST(request("POST", enquiry));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true });
  expect(service).toHaveBeenCalledExactlyOnceWith("submit_enquiry", {
    p_request_id: enquiry.request_id,
    p_post_id: post,
    p_buyer_email: "buyer@example.org",
    p_message: "Is this still available?",
  });
});

it("binds the GoTrue-verified sender, never a body field", async () => {
  authenticateCaller.mockResolvedValueOnce({ api: { rpc }, accountId: account });
  await POST(request("POST", { ...enquiry }));
  expect(service.mock.calls[0][1].p_sender).toBe(account);
  expect((await POST(request("POST", { ...enquiry, sender: post }))).status).toBe(400);
});

it("refuses before any write without origin, CSRF, CAPTCHA or valid input", async () => {
  expect((await POST(request("POST", enquiry, { origin: "https://evil.example" }))).status).toBe(
    403
  );
  expect((await POST(request("POST", enquiry, { csrf: false }))).status).toBe(403);
  expect((await POST(request("POST", { ...enquiry, turnstile_token: "" }))).status).toBe(400);
  vi.mocked(verifyPublicTurnstile).mockResolvedValueOnce(
    Response.json({ error: "CAPTCHA verification failed" }, { status: 400 }) as never
  );
  expect((await POST(request("POST", enquiry))).status).toBe(400);
  expect((await POST(request("POST", { ...enquiry, message: "x" }))).status).toBe(400);
  expect(service).not.toHaveBeenCalled();
});

it("rate limits per client and blocks when the limiter is degraded", async () => {
  vi.mocked(checkRateLimit).mockResolvedValueOnce({ limited: true, retryAfter: 30 });
  expect((await POST(request("POST", enquiry))).status).toBe(429);
  vi.mocked(checkRateLimit).mockResolvedValueOnce({ limited: true, degraded: true });
  expect((await POST(request("POST", enquiry))).status).toBe(503);
  expect(service).not.toHaveBeenCalled();
});

it("maps database refusals without leaking details", async () => {
  for (const [details, status] of [
    ["post_unavailable", 404],
    ["enquiries_disabled", 403],
    ["enquiry_limit", 429],
    ["own_post", 400],
    ["something_internal", 503],
  ] as const) {
    service.mockResolvedValueOnce({ data: null, error: { details, message: "secret" } });
    const response = await POST(request("POST", enquiry));
    expect(response.status).toBe(status);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  }
});

it("fails closed when the service binding or Auth is unavailable", async () => {
  vi.mocked(createFoundationServiceApi).mockImplementationOnce(() => {
    throw new Error("Foundation service binding is unavailable");
  });
  expect((await POST(request("POST", enquiry))).status).toBe(503);
  authenticateCaller.mockRejectedValueOnce(new FoundationSessionError(503));
  expect((await POST(request("POST", enquiry))).status).toBe(503);
});

it("lists and updates only through the owner commands", async () => {
  authenticateCaller.mockResolvedValueOnce({ api: { rpc }, accountId: account });
  const listed = await GET(request("GET", undefined, { query: "?limit=10&status=new" }));
  expect(listed.status).toBe(200);
  expect(await listed.json()).toEqual({
    account_id: account,
    data: { items: [], unread_count: 0, next_cursor: null },
  });
  expect(rpc).toHaveBeenLastCalledWith("list_my_enquiries", { p_limit: 10, p_status: "new" });
  rpc.mockResolvedValueOnce({ data: null, error: null });
  expect((await PATCH(request("PATCH", { id: account, status: "read" }))).status).toBe(404);
  expect((await PATCH(request("PATCH", { id: account, status: "new" }))).status).toBe(400);
});
