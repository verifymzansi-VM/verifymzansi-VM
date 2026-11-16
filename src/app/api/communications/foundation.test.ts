/** @vitest-environment node */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { GET as getPreferences, PATCH as savePreferences } from "./preferences/route";
import { GET as getEmailActivity } from "./email-activity/route";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { COMMUNICATION_WORDING_VERSION } from "@/lib/foundation/communication-choices";

vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: () => ({}),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture" }),
}));
// The retired backend must never be reached from these routes.
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => {
    throw new Error("Retired backend used");
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("Retired backend used");
  }),
}));

const csrf = "c".repeat(64);
const id = "aaaaaaaa-aaaa-4aaa-8aaa-111111111111";
const ALL_OFF = {
  marketing_email: false,
  marketing_sms: false,
  analytics: false,
  third_party_sharing: false,
};
const rpc = vi.fn();
const authenticate = vi.fn();

function request(path: string, method = "GET", body?: unknown, validCsrf = true) {
  return new NextRequest(`https://verifymzansi.com${path}`, {
    method,
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    headers: {
      origin: "https://verifymzansi.com",
      "content-type": "application/json",
      cookie: `vm_csrf=${csrf}`,
      ...(validCsrf ? { "x-csrf-token": csrf } : {}),
    },
  });
}
const preferences = (method = "GET", body?: unknown, validCsrf = true) =>
  request("/api/communications/preferences", method, body, validCsrf);
const activity = () => request("/api/communications/email-activity");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  authenticate.mockResolvedValue({ rpc });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate,
    respond: async (r: NextResponse) => {
      r.headers.set("cache-control", "private, no-store");
      return r;
    },
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
  rpc.mockImplementation(async (name: string) => ({
    error: null,
    data:
      name === "list_my_email_history"
        ? {
            items: [
              { id, kind: "payment_completed", status: "sent", at: "2026-11-13T10:00:00Z" },
              {
                id: "bbbbbbbb-bbbb-4bbb-8bbb-222222222222",
                kind: "post_expired",
                status: "failed",
                at: "2026-11-12T10:00:00+00:00",
              },
            ],
          }
        : name === "save_my_communication_choices"
          ? { ...ALL_OFF, analytics: true }
          : ALL_OFF,
  }));
});
afterEach(() => vi.unstubAllEnvs());

describe("communication choices", () => {
  it("reads the caller's own choices through the foundation command", async () => {
    const response = await getPreferences(preferences());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ preferences: ALL_OFF });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_my_communication_choices");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("saves only the given choice, with the wording version, and returns all four", async () => {
    const response = await savePreferences(preferences("PATCH", { analytics: true }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      preferences: { ...ALL_OFF, analytics: true },
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("save_my_communication_choices", {
      p_wording: COMMUNICATION_WORDING_VERSION,
      p_analytics: true,
    });
  });

  it("passes several choices in one command, turning off as easily as on", async () => {
    await savePreferences(preferences("PATCH", { marketing_email: false, marketing_sms: true }));
    expect(rpc).toHaveBeenCalledExactlyOnceWith("save_my_communication_choices", {
      p_wording: COMMUNICATION_WORDING_VERSION,
      p_marketing_email: false,
      p_marketing_sms: true,
    });
  });

  it.each([
    ["no choice", {}],
    ["a non-boolean", { analytics: "true" }],
    ["an unknown purpose", { data_processing: true }],
    ["a claimed account", { analytics: true, user_id: id }],
    ["a caller-chosen wording", { analytics: true, wording: "communication-2030-01" }],
  ])("refuses %s without calling the database", async (_label, body) => {
    const response = await savePreferences(preferences("PATCH", body));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps CSRF and same-origin protection on saves", async () => {
    expect((await savePreferences(preferences("PATCH", { analytics: true }, false))).status).toBe(
      403
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("asks a signed-out visitor to sign in", async () => {
    authenticate.mockRejectedValue(new FoundationSessionError(401));
    const response = await getPreferences(preferences());
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps the daily limit and hides any other database refusal", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "PT429", details: "choice_limit", message: "too many changes today" },
    });
    let response = await savePreferences(preferences("PATCH", { analytics: true }));
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ reason: "limited" });

    // A restricted account opting in: refused, without the database's words.
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", details: null, message: "active authenticated member required" },
    });
    response = await savePreferences(preferences("PATCH", { analytics: true }));
    expect(response.status).toBe(403);
    let body = await response.json();
    expect(JSON.stringify(body)).not.toContain("active authenticated");
    expect(body).toMatchObject({
      reason: "restricted",
      error: "Your account can't turn this on right now",
    });

    // A session that ended, on any call: sign in again (not "can't turn this on").
    for (const message of ["live session required", "signed-in member required"]) {
      rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", details: null, message } });
      response = await getPreferences(preferences());
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        reason: "session",
        error: "Your session has ended. Sign in again.",
      });
    }

    // Any other refusal of this account: no claim about turning something on.
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", details: null, message: "permission denied for function x" },
    });
    response = await savePreferences(preferences("PATCH", { analytics: false }));
    expect(response.status).toBe(403);
    body = await response.json();
    expect(body).toMatchObject({ reason: "forbidden" });
    expect(body.error).not.toContain("turn this on");

    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "XX000", details: null, message: "relation private.x does not exist" },
    });
    response = await savePreferences(preferences("PATCH", { analytics: true }));
    expect(response.status).toBe(503);
    body = await response.json();
    expect(JSON.stringify(body)).not.toContain("relation");
    expect(body).toMatchObject({ reason: "unavailable" });
  });

  it("refuses an unexpected answer shape instead of showing it", async () => {
    rpc.mockResolvedValueOnce({ data: { ...ALL_OFF, extra: true }, error: null });
    expect((await getPreferences(preferences())).status).toBe(503);
  });

  it("fails closed when the rate limiter is degraded", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ limited: false, degraded: true });
    expect((await getPreferences(preferences())).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("email history", () => {
  it("maps the caller's finished emails to the restored page's rows", async () => {
    const response = await getEmailActivity(activity());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        {
          id,
          action: "communication_email_sent",
          created_at: "2026-11-13T10:00:00Z",
          metadata: { template: "payment_completed" },
        },
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-222222222222",
          action: "communication_email_failed",
          created_at: "2026-11-12T10:00:00+00:00",
          metadata: { template: "post_expired" },
        },
      ],
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("list_my_email_history", { p_limit: 20 });
  });

  it("refuses rows carrying anything beyond kind, status and time", async () => {
    rpc.mockResolvedValueOnce({
      data: {
        items: [
          {
            id,
            kind: "payment_completed",
            status: "sent",
            at: "2026-11-13T10:00:00Z",
            recipient: "someone@example.com",
          },
        ],
      },
      error: null,
    });
    const response = await getEmailActivity(activity());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("someone@example.com");
  });

  it("words its refusals for the history, never 'turn this on'", async () => {
    const cases: Array<[string, number, string]> = [
      ["live session required", 401, "Your session has ended. Sign in again."],
      // A database before 20261113223806 still refuses a restricted account.
      [
        "active authenticated member required",
        403,
        "Your account can't see its email history right now",
      ],
    ];
    for (const [message, status, error] of cases) {
      rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", details: null, message } });
      const response = await getEmailActivity(activity());
      expect(response.status).toBe(status);
      const body = await response.json();
      expect(body).toMatchObject({ error });
      expect(JSON.stringify(body)).not.toContain("turn this on");
    }
  });
});
