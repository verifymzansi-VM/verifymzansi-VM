/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { POST } from "./route";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { foundationLatestSignIn } from "@/lib/foundation/sign-in-claims";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type * as HiddenFeatures from "@/lib/hidden-features";

// Through the real owner route (origin, CSRF, limits, session), with only the
// session context, the limiter and the database call replaced.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: () => ({}),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "client" }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("Retired backend used");
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => {
    throw new Error("Retired backend used");
  }),
}));
// The route is hidden until it works (src/lib/hidden-features.ts); these
// tests switch it on to keep the code behind the switch checked.
const hiddenFeature = vi.hoisted(() => ({ shown: true }));
vi.mock("@/lib/hidden-features", async (importOriginal) => ({
  ...(await importOriginal<typeof HiddenFeatures>()),
  get SHOW_ACCOUNT_DELETION() {
    return hiddenFeature.shown;
  },
}));

const account = "22222222-2222-4222-8222-222222222222";
const csrf = "c".repeat(64);
const rpc = vi.fn();
const now = () => Math.floor(Date.now() / 1000);
let amr: unknown;
let session: "live" | "gone";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("https://verifymzansi.com/api/account/delete", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      origin: "https://verifymzansi.com",
      "content-type": "application/json",
      cookie: `vm_csrf=${csrf}`,
      "x-csrf-token": csrf,
      ...headers,
    },
  });
}
const confirm = { confirmation: "DELETE" };
const closedReply = {
  status: "closed",
  closed_at: "2026-11-17T10:00:00+00:00",
  erase_after: "2026-12-17T10:00:00+00:00",
  request_id: "33333333-3333-4333-8333-333333333333",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  amr = [{ method: "password", timestamp: now() - 60 }];
  session = "live";
  vi.mocked(createFoundationRouteContext).mockImplementation(
    () =>
      ({
        // The verified caller as request-api.ts builds it from the token's amr.
        authenticateCaller: async () => {
          if (session === "gone") throw new FoundationSessionError(401);
          return {
            api: { rpc },
            accountId: account,
            sessionId: account,
            signedInAt: foundationLatestSignIn(amr),
          };
        },
        respond: (response: NextResponse) => response,
      }) as unknown as ReturnType<typeof createFoundationRouteContext>
  );
});
afterEach(() => {
  hiddenFeature.shown = true;
  vi.unstubAllEnvs();
});

it("answers 404 while account deletion is hidden, before any check or database call", async () => {
  hiddenFeature.shown = false;
  const response = await POST(request(confirm));
  expect(response.status).toBe(404);
  expect(checkRateLimit).not.toHaveBeenCalled();
  expect(createFoundationRouteContext).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});

it("refuses a request from another site or without the CSRF token, before any database call", async () => {
  expect((await POST(request(confirm, { origin: "https://attacker.example" }))).status).toBe(403);
  expect((await POST(request(confirm, { "x-csrf-token": "d".repeat(64) }))).status).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});

it("limits each client and then each account, before any database call", async () => {
  vi.mocked(checkRateLimit).mockResolvedValueOnce({ limited: true, retryAfter: 60 });
  expect((await POST(request(confirm))).status).toBe(429);
  expect(checkRateLimit).toHaveBeenLastCalledWith(
    expect.objectContaining({ key: "client", action: "account:delete" })
  );
  vi.mocked(checkRateLimit)
    .mockResolvedValueOnce({ limited: false })
    .mockResolvedValueOnce({ limited: true, retryAfter: 60 });
  const perAccount = await POST(request(confirm));
  expect(perAccount.status).toBe(429);
  expect(checkRateLimit).toHaveBeenLastCalledWith(
    expect.objectContaining({ key: account, action: "account:delete", degradedMode: "block" })
  );
  expect(rpc).not.toHaveBeenCalled();
});

it.each([
  ["recovery", "a reset link"],
  ["magiclink", "a magic link"],
])("sends a %s session (%s) to sign in again, before any database call", async (method) => {
  amr = [{ method, timestamp: now() - 10 }];
  const response = await POST(request(confirm));
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({
    reason: "recent_sign_in_required",
    code: "reauthentication_required",
  });
  expect(rpc).not.toHaveBeenCalled();
});

it("closes the account of a fresh password sign-in and reports the planned dates", async () => {
  rpc.mockResolvedValueOnce({ data: closedReply, error: null });
  const response = await POST(request(confirm));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    status: "closed",
    closedAt: closedReply.closed_at,
    eraseAfter: closedReply.erase_after,
    eraseBy: "2026-12-24T10:00:00.000Z",
  });
  expect(rpc).toHaveBeenCalledWith("close_my_account", {}, { get: false });
  expect(createAdminClient).not.toHaveBeenCalled();
  expect(createClient).not.toHaveBeenCalled();
});

it("expires the session cookies once the account is closed, and only then", async () => {
  const withSession = {
    cookie: `vm_csrf=${csrf}; sb-local-auth-token.0=a; sb-local-auth-token.1=b; theme=dark`,
  };
  rpc.mockResolvedValueOnce({ data: closedReply, error: null });
  const closed = await POST(request(confirm, withSession));
  expect(closed.status).toBe(200);
  for (const name of ["sb-local-auth-token.0", "sb-local-auth-token.1"])
    expect(closed.cookies.get(name)).toMatchObject({ value: "", maxAge: 0, path: "/" });
  expect(closed.cookies.get("theme")).toBeUndefined();
  expect(closed.cookies.get("vm_csrf")).toBeUndefined();

  rpc.mockResolvedValueOnce({ data: null, error: { code: "55000", message: "not closed" } });
  const refused = await POST(request(confirm, withSession));
  expect(refused.status).toBe(503);
  expect(refused.cookies.get("sb-local-auth-token.0")).toBeUndefined();
});

it("answers a second tab's request after the first closed the account as signed out", async () => {
  // Both passed the session check; the first closure then ended every session,
  // so the database refuses the second with no reason.
  rpc.mockResolvedValueOnce({
    data: null,
    error: { code: "42501", message: "live confirmed member session required", details: null },
  });
  const response = await POST(request(confirm));
  expect(response.status).toBe(401);
  const body = await response.json();
  expect(body).toMatchObject({ reason: "session_required", code: "session_required" });
  expect(body.error).toContain("If you just deleted your account, it is closed");
  expect(body.error).toContain("email address is not confirmed");
});

it("asks for a fresh sign-in when the database refuses the session's sign-in", async () => {
  // A Google sign-in the route accepts, refused by the database's own check
  // (internal.account_closing_actor, which counts only a password or Google
  // sign-in from the last 15 minutes).
  amr = [{ method: "oauth", timestamp: now() - 60 }];
  rpc.mockResolvedValueOnce({
    data: null,
    error: {
      code: "42501",
      message: "sign in again to close the account",
      details: "recent_sign_in_required",
    },
  });
  const response = await POST(request(confirm));
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({
    reason: "recent_sign_in_required",
    code: "reauthentication_required",
  });
  expect(rpc).toHaveBeenCalledTimes(1);
});

it("says the outcome is unknown when the answer is lost after sending", async () => {
  rpc.mockResolvedValueOnce({ data: null, error: { code: "", message: "fetch failed" } });
  const response = await POST(request(confirm));
  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body).toMatchObject({
    code: "outcome_unknown",
    error:
      "We couldn't confirm whether your account was closed. Try signing in: if you can't, it was closed. Contact support if unsure.",
  });
  expect(body.error).not.toMatch(/could not be closed/);
});

it("answers a retry after a closure with the closed state, not a bare sign-in request", async () => {
  rpc.mockResolvedValueOnce({ data: closedReply, error: null });
  expect((await POST(request(confirm))).status).toBe(200);
  // The closure ended every session.
  session = "gone";
  const retry = await POST(request(confirm));
  expect(retry.status).toBe(401);
  expect(await retry.json()).toEqual({
    error:
      "You are signed out. If you just deleted your account, it is closed; otherwise sign in again to delete it.",
  });
  expect(rpc).toHaveBeenCalledTimes(1);
});

it("refuses a missing confirmation word without calling the database", async () => {
  const response = await POST(request({ confirmation: "yes" }));
  expect(response.status).toBe(422);
  expect(rpc).not.toHaveBeenCalled();
});
