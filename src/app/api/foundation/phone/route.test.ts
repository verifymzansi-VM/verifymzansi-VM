/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as send } from "./send/route";
import { POST as verify } from "./verify/route";
import { POST as restoredSend } from "@/app/api/otp/send/route";
import { POST as restoredVerify } from "@/app/api/otp/verify/route";
import { FOUNDATION_PHONE_CHALLENGE_COOKIE } from "@/lib/foundation/phone-challenge-cookie";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { CSRF_HEADER_NAME } from "@/lib/utils/csrf";
const { authenticate, readAccount, service, issue, prove, limit, context } = vi.hoisted(() => ({
  authenticate: vi.fn(),
  readAccount: vi.fn(),
  service: vi.fn(),
  issue: vi.fn(),
  prove: vi.fn(),
  limit: vi.fn(),
  context: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: () => ({}),
}));
vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext: context }));
vi.mock("@/lib/foundation/account-context", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readFoundationAccountContext: readAccount,
}));
vi.mock("@/lib/foundation/service-api", () => ({ createFoundationServiceApi: service }));
vi.mock("@/lib/foundation/phone-verification", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  issueFoundationPhoneChallenge: issue,
  verifyFoundationPhoneChallenge: prove,
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: limit,
  getClientRateLimitIdentity: () => ({ key: "synthetic-ip" }),
}));
vi.mock("@/lib/security/security-events", () => ({
  recordSecurityEvent: vi.fn(),
  securityContext: () => ({}),
}));
const owner = "00000000-0000-4000-8000-000000000001";
const challenge = "00000000-0000-4000-8000-000000000002";
const api = {};
const serviceApi = {};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FOUNDATION_PHONE_VERIFICATION_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  context.mockReturnValue({ authenticate, respond: async (response: Response) => response });
  authenticate.mockResolvedValue(api);
  readAccount.mockResolvedValue({ account_id: owner });
  service.mockReturnValue(serviceApi);
  issue.mockResolvedValue({ challenge_id: challenge, expires_at: "2026-10-24T18:00:00Z" });
  prove.mockResolvedValue({ verified: true });
  limit.mockResolvedValue({ limited: false });
});
afterEach(() => vi.unstubAllEnvs());
function request(body: unknown, origin = "https://verifymzansi.com", csrf = true) {
  const token = "c".repeat(64);
  return new NextRequest("https://verifymzansi.com/api/foundation/phone/send", {
    method: "POST",
    headers: {
      origin,
      "Content-Type": "application/json",
      ...(csrf ? { cookie: `vm_csrf=${token}`, [CSRF_HEADER_NAME]: token } : {}),
    },
    body: JSON.stringify(body),
  });
}

it("connects the preserved phone form to a signed, owner-bound native challenge", async () => {
  vi.stubEnv("NEXT_PUBLIC_DATA_BACKEND", "foundation");
  vi.stubEnv("FOUNDATION_PHONE_OTP_KEY", "0123456789abcdef".repeat(4));
  issue.mockResolvedValue({
    challenge_id: challenge,
    expires_at: new Date(Date.now() + 300_000).toISOString(),
  });
  const sent = await restoredSend(request({ phone: "082 000 0000" }));
  expect(sent.status).toBe(200);
  expect(await sent.json()).toEqual({ success: true });
  const cookie = sent.cookies.get(FOUNDATION_PHONE_CHALLENGE_COOKIE)!;
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.secure).toBe(true);
  expect(cookie.path).toBe("/api/otp");
  expect(cookie.value).not.toContain("082");
  const incoming = request({ phone: "0820000000", otp: "123456" });
  incoming.cookies.set(FOUNDATION_PHONE_CHALLENGE_COOKIE, cookie.value);
  const verified = await restoredVerify(incoming);
  expect(verified.status).toBe(200);
  expect(prove).toHaveBeenCalledWith(serviceApi, owner, {
    challenge_id: challenge,
    code: "123456",
  });
  expect(verified.cookies.get(FOUNDATION_PHONE_CHALLENGE_COOKIE)?.maxAge).toBe(0);
});

it("does not verify a restored OTP against a different number, owner or altered challenge", async () => {
  vi.stubEnv("NEXT_PUBLIC_DATA_BACKEND", "foundation");
  vi.stubEnv("FOUNDATION_PHONE_OTP_KEY", "0123456789abcdef".repeat(4));
  issue.mockResolvedValue({
    challenge_id: challenge,
    expires_at: new Date(Date.now() + 300_000).toISOString(),
  });
  const sent = await restoredSend(request({ phone: "0820000000" }));
  const cookie = sent.cookies.get(FOUNDATION_PHONE_CHALLENGE_COOKIE)!.value;
  for (const [phone, proof] of [
    ["0830000000", cookie],
    ["0820000000", cookie + "bad"],
  ]) {
    const incoming = request({ phone, otp: "123456" });
    incoming.cookies.set(FOUNDATION_PHONE_CHALLENGE_COOKIE, proof);
    expect((await restoredVerify(incoming)).status).toBe(400);
  }
  readAccount.mockResolvedValue({ account_id: challenge });
  const incoming = request({ phone: "0820000000", otp: "123456" });
  incoming.cookies.set(FOUNDATION_PHONE_CHALLENGE_COOKIE, cookie);
  expect((await restoredVerify(incoming)).status).toBe(400);
  expect(prove).not.toHaveBeenCalled();
});
it("stays disabled until the native phone deployment is enabled", async () => {
  vi.stubEnv("FOUNDATION_PHONE_VERIFICATION_ENABLED", "");
  const response = await send(request({ phone: "+27820000000" }));
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(context).not.toHaveBeenCalled();
});
it.each([
  ["https://external.example", true],
  ["https://verifymzansi.com", false],
])(
  "rejects untrusted mutation proof before authentication or delivery %s",
  async (origin, csrf) => {
    expect((await send(request({ phone: "+27820000000" }, origin, csrf))).status).toBe(403);
    expect(context).not.toHaveBeenCalled();
    expect(issue).not.toHaveBeenCalled();
  }
);
it("requires a verified caller before reading the account or creating a service client", async () => {
  authenticate.mockRejectedValue(new FoundationSessionError(401));
  expect((await send(request({ phone: "+27820000000" }))).status).toBe(401);
  expect(readAccount).not.toHaveBeenCalled();
  expect(service).not.toHaveBeenCalled();
});
it("binds delivery to the canonical account and reserves IP/account/phone limits before delivery", async () => {
  expect((await send(request({ phone: "+27820000000" }))).status).toBe(200);
  expect(issue).toHaveBeenCalledWith(serviceApi, owner, { phone: "+27820000000" });
  expect(limit.mock.calls.map((call) => call[0])).toEqual([
    { key: "synthetic-ip", action: "otp:send:ip", degradedMode: "block" },
    { key: owner, action: "otp:send:user", degradedMode: "block" },
    { key: "+27820000000", action: "otp:send", degradedMode: "block" },
  ]);
});
it("does not accept a browser-supplied account selector", async () => {
  expect((await send(request({ phone: "+27820000000", owner_id: challenge }))).status).toBe(400);
  expect(service).not.toHaveBeenCalled();
  expect(issue).not.toHaveBeenCalled();
});
it("does not send SMS when the shared account protection is degraded", async () => {
  limit
    .mockResolvedValueOnce({ limited: false })
    .mockResolvedValueOnce({ limited: true, degraded: true });
  expect((await send(request({ phone: "+27820000000" }))).status).toBe(503);
  expect(service).not.toHaveBeenCalled();
  expect(issue).not.toHaveBeenCalled();
});
it("verifies only the canonical caller's challenge and enforces a shared account attempt limit", async () => {
  expect((await verify(request({ challenge_id: challenge, code: "123456" }))).status).toBe(200);
  expect(prove).toHaveBeenCalledWith(serviceApi, owner, {
    challenge_id: challenge,
    code: "123456",
  });
  expect(limit).toHaveBeenLastCalledWith({
    key: owner,
    action: "otp:verify:user",
    degradedMode: "block",
  });
  expect(issue).not.toHaveBeenCalled();
});
