/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import type { FoundationServiceApi } from "./service-api";
import {
  handleIdentityCheckAsk,
  handleIdentityCheckAvailability,
  handleIdentityCheckStart,
  pauseAutomaticChecks,
  refuseWhileAutomaticCheckOpen,
} from "./identity-check";
import { createDiditSession, deleteDiditSession, DiditError } from "./didit-client";
import { checkRateLimit } from "../utils/rate-limit";
import { networkHash } from "./identity-check-context";
import { FoundationVerificationError } from "./verification-runtime";
import { sendStaffOperationsEmail } from "../services/email";
import { recordIdentityCheckResult } from "./identity-check-result";
import {
  FoundationProfileError,
  readFoundationAccountProfile,
  saveFoundationLegalNameClaim,
} from "./account-profile";
import { IDENTITY_CHECK_CONSENT_VERSION } from "../verification/identity-check-consent";
vi.mock("server-only", () => ({}));
vi.mock("./account-profile", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readFoundationAccountProfile: vi.fn(),
  saveFoundationLegalNameClaim: vi.fn(),
}));
vi.mock("./didit-client", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  createDiditSession: vi.fn(),
  deleteDiditSession: vi.fn(),
}));
vi.mock("./identity-check-result", () => ({ recordIdentityCheckResult: vi.fn() }));
vi.mock("../services/email", () => ({ sendStaffOperationsEmail: vi.fn() }));
vi.mock("./service-api", () => ({ createFoundationServiceApi: () => ({ rpc: serviceRpc }) }));
// The shared owner route (origin, CSRF, rate limit, session) is tested on its
// own; here it runs the command for a fixed signed-in member.
vi.mock("./owner-route", () => ({
  handleFoundationOwnerRoute: async (options: {
    request: NextRequest;
    command: (api: unknown, input: unknown, caller: unknown) => Promise<unknown>;
    refusal: (error: unknown) => unknown;
  }) => {
    const input = await options.request.json().catch(() => null);
    try {
      return {
        data: await options.command({ rpc }, input, { accountId: owner, sessionId: owner }),
      };
    } catch (error) {
      const refused = options.refusal(error);
      if (!refused) throw error;
      return { refused };
    }
  },
}));
vi.mock("../utils/rate-limit", () => ({
  getClientIp: () => "198.51.100.7",
  checkRateLimit: vi.fn(),
}));

const owner = "11111111-1111-4111-8111-111111111111";
const check = "22222222-2222-4222-8222-222222222222";
const session = "33333333-3333-4333-8333-333333333333";
const rpc = vi.fn();
const serviceRpc = vi.fn();
const api = { rpc } as unknown as FoundationAuthenticatedApi;
const noCheck = { route: "automatic", reason: null, check: null };
const post = (path: string, body: unknown = {}) =>
  new NextRequest(`https://verifymzansi.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (iPhone)" },
    body: JSON.stringify(body),
  });
const consented = {
  consent: true,
  consentVersion: IDENTITY_CHECK_CONSENT_VERSION,
  firstName: "Thando Sipho",
  lastName: "Dlamini",
};
const start = (body: unknown = consented) =>
  handleIdentityCheckStart(post("/api/verification/identity-check", body)) as unknown as Promise<{
    data?: unknown;
    refused?: { status: number; code: string; retryAfter?: number };
  }>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("HMAC_SECRET", "0123456789abcdef".repeat(4));
  vi.stubEnv("DIDIT_API_KEY", "fixture-key");
  vi.stubEnv("DIDIT_WORKFLOW_ID", "77777777-7777-4777-8777-777777777777");
  vi.mocked(sendStaffOperationsEmail).mockResolvedValue({ success: true } as never);
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false, retryAfter: 0 });
  vi.mocked(deleteDiditSession).mockResolvedValue(undefined);
  vi.mocked(readFoundationAccountProfile).mockResolvedValue({
    legal_first_name: "Thando Sipho",
    legal_last_name: "Dlamini",
    revision: 4,
  } as never);
  vi.mocked(saveFoundationLegalNameClaim).mockResolvedValue({} as never);
  serviceRpc.mockImplementation(async (name: string) =>
    name === "report_identity_check_unavailable"
      ? {
          data: {
            paused_until: "2026-11-21T11:00:00Z",
            pause_reason: "no_credit",
            newly_paused: true,
          },
          error: null,
        }
      : { data: { check_id: check, reused: false }, error: null }
  );
});

describe("the photo routes while the automatic route is open", () => {
  it("are refused only when the database answers route automatic", async () => {
    rpc.mockResolvedValueOnce({
      data: { route: "manual", reason: "mode", check: null },
      error: null,
    });
    await expect(refuseWhileAutomaticCheckOpen(api)).resolves.toBeUndefined();
    rpc.mockResolvedValueOnce({
      data: { route: "manual", reason: "limit", check: null },
      error: null,
    });
    await expect(refuseWhileAutomaticCheckOpen(api)).resolves.toBeUndefined();
    rpc.mockResolvedValueOnce({
      data: { route: "automatic", reason: null, check: null },
      error: null,
    });
    await expect(refuseWhileAutomaticCheckOpen(api)).rejects.toMatchObject({ status: 409 });
    expect(rpc).toHaveBeenCalledWith("get_identity_check_availability", {}, { get: false });
  });

  it("fail closed when the route cannot be read", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "57014" } });
    await expect(refuseWhileAutomaticCheckOpen(api)).rejects.toBeInstanceOf(
      FoundationVerificationError
    );
    rpc.mockResolvedValueOnce({ data: { route: "other" }, error: null });
    await expect(refuseWhileAutomaticCheckOpen(api)).rejects.toMatchObject({ status: 503 });
  });
});

describe("a pause", () => {
  const service = { rpc: serviceRpc } as unknown as FoundationServiceApi;

  it("sends one alert, only from the call that started it", async () => {
    await pauseAutomaticChecks(service, check, "no_credit");
    expect(serviceRpc).toHaveBeenCalledWith("report_identity_check_unavailable", {
      p_check: check,
      p_reason: "no_credit",
    });
    expect(sendStaffOperationsEmail).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        idempotencyKey: "identity-check-paused/2026-11-21T11:00:00Z",
        subject: "VerifyMzansi: automatic ID checks paused",
      })
    );
    serviceRpc.mockResolvedValueOnce({
      data: { paused_until: "2026-11-21T11:00:00Z", pause_reason: "outage", newly_paused: false },
      error: null,
    });
    await pauseAutomaticChecks(service, check, "outage");
    expect(sendStaffOperationsEmail).toHaveBeenCalledTimes(1);
  });

  it("keeps going when the alert cannot be sent", async () => {
    vi.mocked(sendStaffOperationsEmail).mockRejectedValueOnce(new Error("provider"));
    await expect(pauseAutomaticChecks(service, check, "outage")).resolves.toBeUndefined();
  });
});

describe("starting a check", () => {
  const started = (session_url: string | null = null) => ({
    data: {
      check_id: check,
      session_id: session_url ? session : null,
      session_url,
      created: !session_url,
    },
    error: null,
  });
  const memberRpc = (first: unknown) =>
    rpc.mockImplementation(async (name: string) => {
      if (name === "get_identity_check_availability") return { data: noCheck, error: null };
      if (name !== "start_my_identity_check") throw new Error(`unexpected ${name}`);
      return first;
    });

  it("makes the start record first, so a missing secret creates no check and no partner session", async () => {
    memberRpc(started());
    vi.stubEnv("HMAC_SECRET", "");
    await expect(start()).rejects.toBeInstanceOf(FoundationVerificationError);
    expect(rpc).not.toHaveBeenCalledWith(
      "start_my_identity_check",
      expect.anything(),
      expect.anything()
    );
    expect(createDiditSession).not.toHaveBeenCalled();
  });

  it("limits starts per account, not per network address", async () => {
    memberRpc(started("https://verify.didit.me/session/old"));
    await start();
    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ key: owner, action: "verification:identity-check" })
    );
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ limited: true, retryAfter: 45 });
    expect((await start()).refused).toMatchObject({
      status: 429,
      code: "rate_limited",
      retryAfter: 45,
    });
  });

  it("needs the member's consent to the current words before anything starts", async () => {
    memberRpc(started());
    for (const body of [
      {},
      { ...consented, consent: false },
      { ...consented, consentVersion: "identity-check-consent-v0" },
      { firstName: "Thando", lastName: "Dlamini" },
      { ...consented, owner },
    ]) {
      expect((await start(body)).refused).toMatchObject({
        status: 400,
        code: "consent_required",
      });
    }
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(saveFoundationLegalNameClaim).not.toHaveBeenCalled();
    expect(createDiditSession).not.toHaveBeenCalled();
  });

  it("sends the consent version with the start, matching the database's", async () => {
    memberRpc(started("https://verify.didit.me/session/old"));
    await start();
    expect(rpc).toHaveBeenCalledWith(
      "start_my_identity_check",
      { p_consent_version: IDENTITY_CHECK_CONSENT_VERSION },
      { get: false }
    );
    // The value of internal.identity_check_consent_version() in update
    // 20261124235920_identity_check_consent (part 7a, PR #361). Hard-coded
    // until database/foundation/current/functions/internal/
    // identity_check_consent_version.sql is on main; then read it from there.
    expect(IDENTITY_CHECK_CONSENT_VERSION).toBe("identity-check-consent-v1");
  });

  it("saves the typed names as the member's name claim before the check starts", async () => {
    const order: string[] = [];
    rpc.mockImplementation(async (name: string) => {
      order.push(name);
      if (name === "get_identity_check_availability") return { data: noCheck, error: null };
      return started("https://verify.didit.me/session/old");
    });
    vi.mocked(saveFoundationLegalNameClaim).mockImplementation(async () => {
      order.push("save_my_legal_name");
      return {} as never;
    });
    await start({ ...consented, firstName: " Thando Sipho ", lastName: "Dlamini" });
    expect(saveFoundationLegalNameClaim).not.toHaveBeenCalled();
    await start({ ...consented, firstName: "Thando", lastName: "Dlamini" });
    expect(saveFoundationLegalNameClaim).toHaveBeenCalledWith(expect.anything(), {
      expected_revision: 4,
      first_name: "Thando",
      last_name: "Dlamini",
    });
    expect(order.indexOf("save_my_legal_name")).toBeLessThan(
      order.lastIndexOf("start_my_identity_check")
    );
    vi.mocked(saveFoundationLegalNameClaim).mockRejectedValueOnce(
      new FoundationProfileError("locked")
    );
    expect((await start({ ...consented, firstName: "Sipho" })).refused).toMatchObject({
      status: 409,
      code: "legal_name_locked",
    });
    vi.mocked(saveFoundationLegalNameClaim).mockRejectedValueOnce(
      new FoundationProfileError("invalid")
    );
    expect((await start({ ...consented, firstName: "Sipho" })).refused).toMatchObject({
      status: 400,
      code: "legal_name_invalid",
    });
  });

  it("keeps the attached session when two starts race, and removes the extra one", async () => {
    const attachedUrl = "https://verify.didit.me/session/first";
    rpc.mockImplementation(async (name: string) =>
      name === "start_my_identity_check"
        ? started()
        : {
            data: {
              route: "automatic",
              reason: null,
              check: {
                id: check,
                status: "started",
                created_at: new Date().toISOString(),
                session_id: "44444444-4444-4444-8444-444444444444",
                session_url: attachedUrl,
              },
            },
            error: null,
          }
    );
    vi.mocked(createDiditSession).mockResolvedValue({
      sessionId: session,
      url: "https://verify.didit.me/session/second",
    });
    serviceRpc.mockImplementation(async (name: string) =>
      name === "attach_identity_check_session"
        ? { data: null, error: { code: "PT409" } }
        : { data: null, error: null }
    );
    expect(await start()).toEqual({ data: { checkId: check, url: attachedUrl } });
    expect(deleteDiditSession).toHaveBeenCalledWith(expect.anything(), session);
    // The extra session is removed after the winner is read.
    expect(Math.max(...rpc.mock.invocationCallOrder)).toBeLessThan(
      vi.mocked(deleteDiditSession).mock.invocationCallOrder[0]
    );
    // A failed clean-up does not change the answer.
    vi.mocked(deleteDiditSession).mockRejectedValueOnce(new DiditError("outage"));
    expect(await start()).toEqual({ data: { checkId: check, url: attachedUrl } });
  });

  it("creates the partner session with the check id only, and records where the member started", async () => {
    memberRpc(started());
    vi.mocked(createDiditSession).mockResolvedValue({
      sessionId: session,
      url: "https://verify.didit.me/session/abc",
    });
    expect(await start()).toEqual({
      data: { checkId: check, url: "https://verify.didit.me/session/abc" },
    });
    expect(vi.mocked(createDiditSession).mock.calls[0]).toEqual([expect.anything(), check]);
    expect(serviceRpc).toHaveBeenCalledWith("attach_identity_check_session", {
      p_check: check,
      p_session_id: session,
      p_session_url: "https://verify.didit.me/session/abc",
      p_network_hash: networkHash("198.51.100.7"),
      p_device_kind: "phone",
    });
  });

  it("resumes an unfinished check without a new partner session", async () => {
    memberRpc(started("https://verify.didit.me/session/old"));
    expect(await start()).toEqual({
      data: { checkId: check, url: "https://verify.didit.me/session/old" },
    });
    expect(createDiditSession).not.toHaveBeenCalled();
  });

  it("passes on the database's refusals (manual setting, limits, pause, a person checking)", async () => {
    for (const reason of [
      "identity_check_mode",
      "identity_check_limit",
      "identity_check_paused",
      "identity_check_with_person",
      "verified_phone_required",
    ]) {
      memberRpc({ data: null, error: { code: "PT409", details: reason } });
      expect((await start()).refused).toMatchObject({ status: 409, code: reason });
    }
    expect(createDiditSession).not.toHaveBeenCalled();
  });

  it("pauses automatic checks when the partner cannot start one", async () => {
    memberRpc(started());
    vi.mocked(createDiditSession).mockRejectedValue(new DiditError("no_credit", 400));
    expect((await start()).refused).toMatchObject({ status: 409, code: "identity_check_paused" });
    expect(serviceRpc).toHaveBeenCalledWith("report_identity_check_unavailable", {
      p_check: check,
      p_reason: "no_credit",
    });
    expect(serviceRpc).not.toHaveBeenCalledWith("attach_identity_check_session", expect.anything());
    vi.stubEnv("DIDIT_API_KEY", "");
    vi.mocked(createDiditSession).mockClear();
    expect((await start()).refused).toMatchObject({ code: "identity_check_paused" });
    expect(serviceRpc).toHaveBeenCalledWith("report_identity_check_unavailable", {
      p_check: check,
      p_reason: "not_configured",
    });
    expect(createDiditSession).not.toHaveBeenCalled();
  });
});

describe("a check whose result was lost", () => {
  const availability = (minutesAgo: number, status = "started") => ({
    route: "automatic",
    reason: null,
    check: {
      id: check,
      status,
      created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      session_id: status === "started" ? session : null,
      session_url: status === "started" ? "https://verify.didit.me/session/abc" : null,
    },
  });
  const read = () =>
    handleIdentityCheckAvailability(
      new NextRequest("https://verifymzansi.com/api/verification/identity-check")
    ) as unknown as Promise<{ data?: { check?: { status: string } } }>;

  it("is looked at again when the member asks after 10 minutes, then read again", async () => {
    rpc
      .mockResolvedValueOnce({ data: availability(11), error: null })
      .mockResolvedValueOnce({ data: availability(11, "approved"), error: null });
    vi.mocked(recordIdentityCheckResult).mockResolvedValue({ recorded: true, status: "approved" });
    expect((await read()).data?.check?.status).toBe("approved");
    expect(recordIdentityCheckResult).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({ apiKey: "fixture-key" }),
      session
    );
  });

  it("is looked at no more than once per check every 2 minutes", async () => {
    rpc.mockResolvedValue({ data: availability(30), error: null });
    vi.mocked(recordIdentityCheckResult).mockResolvedValue({
      recorded: false,
      status: "In Progress",
    });
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ limited: true, retryAfter: 100 });
    expect((await read()).data?.check?.status).toBe("started");
    expect(recordIdentityCheckResult).not.toHaveBeenCalled();
    // Fails closed without the shared limiter, and records no security event.
    expect(checkRateLimit).toHaveBeenCalledWith({
      key: check,
      action: "verification:identity-check-look",
      degradedMode: "block",
      quiet: true,
    });
    await read();
    expect(recordIdentityCheckResult).toHaveBeenCalledTimes(1);
  });

  it("is left alone when younger than 10 minutes, finished, or when looking again fails", async () => {
    rpc.mockResolvedValue({ data: availability(5), error: null });
    expect((await read()).data?.check?.status).toBe("started");
    rpc.mockResolvedValue({ data: availability(60, "declined"), error: null });
    await read();
    expect(recordIdentityCheckResult).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: availability(60), error: null });
    vi.mocked(recordIdentityCheckResult).mockRejectedValueOnce(new Error("partner"));
    expect((await read()).data?.check?.status).toBe("started");
    expect(recordIdentityCheckResult).toHaveBeenCalledTimes(1);
  });
});

describe("asking a person", () => {
  const ask = (body: unknown) =>
    handleIdentityCheckAsk(
      post("/api/verification/identity-check/ask", body)
    ) as unknown as Promise<{
      data?: unknown;
      refused?: { status: number; code: string };
    }>;

  it("records the request with the member's own session", async () => {
    rpc.mockResolvedValue({
      data: { check_id: check, asked_at: "2026-11-21T10:00:00Z", reused: false },
      error: null,
    });
    const reason = "The photo was sharp; please look again at my ID.";
    expect((await ask({ checkId: check, reason })).data).toMatchObject({ check_id: check });
    expect(rpc).toHaveBeenCalledWith(
      "ask_person_identity_check",
      { p_check: check, p_reason: reason },
      { get: false }
    );
  });

  it("refuses a short note, extra fields and a check that can no longer go to a person", async () => {
    expect((await ask({ checkId: check, reason: "too short" })).refused?.status).toBe(400);
    expect(
      (await ask({ checkId: check, reason: "x".repeat(30), owner: owner })).refused?.status
    ).toBe(400);
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PT409", details: "ask_person_unavailable" },
    });
    expect((await ask({ checkId: check, reason: "x".repeat(30) })).refused).toMatchObject({
      status: 409,
      code: "ask_person_unavailable",
    });
  });
});
