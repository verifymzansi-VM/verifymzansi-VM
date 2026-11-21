/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import type { FoundationServiceApi } from "./service-api";
import {
  handleIdentityCheckAsk,
  handleIdentityCheckStart,
  pauseAutomaticChecks,
  refuseWhileAutomaticCheckOpen,
} from "./identity-check";
import { createDiditSession, DiditError } from "./didit-client";
import { openStartContext } from "./identity-check-context";
import { FoundationVerificationError } from "./verification-runtime";
import { sendStaffOperationsEmail } from "../services/email";
vi.mock("server-only", () => ({}));
vi.mock("./didit-client", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  createDiditSession: vi.fn(),
}));
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
vi.mock("../utils/rate-limit", () => ({ getClientIp: () => "198.51.100.7" }));

const owner = "11111111-1111-4111-8111-111111111111";
const check = "22222222-2222-4222-8222-222222222222";
const session = "33333333-3333-4333-8333-333333333333";
const rpc = vi.fn();
const serviceRpc = vi.fn();
const api = { rpc } as unknown as FoundationAuthenticatedApi;
const profile = {
  display_name: "Thando D",
  public_name: "Thando D.",
  bio: null,
  avatar_object_id: null,
  legal_first_name: "Thando Sipho",
  legal_last_name: "Dlamini",
  legal_name_locked: false,
  identity_verified: false,
  revision: 1,
  updated_at: "2026-11-21T10:00:00Z",
};
const post = (path: string, body: unknown = {}) =>
  new NextRequest(`https://verifymzansi.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (iPhone)" },
    body: JSON.stringify(body),
  });
const start = () =>
  handleIdentityCheckStart(post("/api/verification/identity-check")) as unknown as Promise<{
    data?: unknown;
    refused?: { status: number; code: string };
  }>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ID_ENCRYPTION_KEY", "fedcba9876543210".repeat(4));
  vi.stubEnv("DIDIT_API_KEY", "fixture-key");
  vi.stubEnv("DIDIT_WORKFLOW_ID", "77777777-7777-4777-8777-777777777777");
  vi.mocked(sendStaffOperationsEmail).mockResolvedValue({ success: true } as never);
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
    rpc.mockImplementation(async (name: string) =>
      name === "start_my_identity_check" ? first : { data: profile, error: null }
    );

  it("creates the partner session with the sealed start context and binds it to the check", async () => {
    memberRpc(started());
    vi.mocked(createDiditSession).mockResolvedValue({
      sessionId: session,
      url: "https://verify.didit.me/session/abc",
    });
    expect(await start()).toEqual({
      data: { checkId: check, url: "https://verify.didit.me/session/abc" },
    });
    const sealed = vi.mocked(createDiditSession).mock.calls[0]![1];
    expect(sealed.checkId).toBe(check);
    expect(openStartContext(check, sealed.sealedContext)).toEqual({
      owner,
      first: "Thando Sipho",
      last: "Dlamini",
      network: "4:198.51.100",
      device: "handheld",
    });
    expect(serviceRpc).toHaveBeenCalledWith("attach_identity_check_session", {
      p_check: check,
      p_session_id: session,
      p_session_url: "https://verify.didit.me/session/abc",
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
