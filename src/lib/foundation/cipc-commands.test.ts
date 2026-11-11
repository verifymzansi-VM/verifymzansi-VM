/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { z } from "zod";
import { handleNativeCipcOwnerAction, handleNativeCipcStaffAction } from "./cipc-commands";
import { currentBusinessClaim, readMyBusinessChecks } from "./business-seen";
import { FoundationSessionError } from "./request-api";
import { createFoundationRouteContext } from "./request-route";
import { createFoundationServiceApi } from "./service-api";
import { FoundationStaffCommandError } from "./staff-command";
import { hashCode } from "../business-verification/representative";
import { sendWorkEmailCode } from "../services/email";
import { checkRateLimit } from "../utils/rate-limit";

vi.mock("./runtime-connection", () => ({ readFoundationRuntimeConnection: vi.fn(() => ({})) }));
vi.mock("./request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("./service-api", () => ({ createFoundationServiceApi: vi.fn() }));
vi.mock("./business-seen", () => ({
  currentBusinessClaim: vi.fn(),
  readMyBusinessChecks: vi.fn(),
}));
vi.mock("../services/email", () => ({ sendWorkEmailCode: vi.fn() }));
vi.mock("../utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: vi.fn(() => ({ key: "client" })),
}));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [account, session, business, caseId, source, nonce] = [1, 2, 3, 4, 5, 6].map(uuid);
const csrf = "c".repeat(64);
const api = { rpc: vi.fn() };
const service = { rpc: vi.fn() };
const authenticate = vi.fn(async () => api);
const ok = (data: unknown) => ({ data, error: null });
const request = (body: unknown, withCsrf = true) =>
  new NextRequest("https://verifymzansi.com/api/businesses/x/verification", {
    method: "POST",
    headers: {
      origin: "https://verifymzansi.com",
      "content-type": "application/json",
      cookie: `vm_csrf=${csrf}`,
      ...(withCsrf ? { "x-csrf-token": csrf } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const json = async (r: NextResponse) => ({ status: r.status, body: await r.json() });
const owner = (
  action: Parameters<typeof handleNativeCipcOwnerAction>[2],
  body: unknown,
  id = business
) => handleNativeCipcOwnerAction(request(body), id, action);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false } as never);
  vi.mocked(createFoundationServiceApi).mockReturnValue(service as never);
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate,
    authenticateCaller: vi.fn(async () => ({ api, accountId: account, sessionId: session })),
    respond: vi.fn(async (r: NextResponse) => r),
  } as never);
  vi.mocked(readMyBusinessChecks).mockResolvedValue({
    business: { name: "Example Trading" },
  } as never);
  vi.mocked(sendWorkEmailCode).mockResolvedValue({ success: true } as never);
  vi.mocked(currentBusinessClaim).mockResolvedValue({ generation: "4", nonce });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("owner CIPC commands", () => {
  it.each([
    ["renew", {}, { p_business: business }],
    ["link", { sourceBusinessId: source }, { p_business: business, p_source: source }],
  ] as const)("%s requests a recheck and answers 201", async (action, body, args) => {
    api.rpc.mockResolvedValue(ok({ caseId, status: "pending" }));
    expect(await json(await owner(action, body))).toEqual({
      status: 201,
      body: { caseId, status: "pending" },
    });
    expect(api.rpc).toHaveBeenCalledExactlyOnceWith("request_frontend_cipc_recheck", args, {
      get: false,
    });
  });

  it.each([
    ["renew with a smuggled source", "renew", { sourceBusinessId: source }, business],
    ["link without a source", "link", {}, business],
    ["a malformed business id", "renew", {}, "not-a-uuid"],
    ["route-switch with a bad case", "route-switch", { caseId: "x" }, business],
    ["office-visibility with a string", "office-visibility", { showFull: "yes" }, business],
  ] as const)("refuses %s before any database call", async (_n, action, body, id) => {
    expect((await owner(action, body, id)).status).toBe(422);
    expect(api.rpc).not.toHaveBeenCalled();
  });

  it("refuses an office visibility answer that does not echo the request", async () => {
    api.rpc.mockResolvedValue(ok({ showFull: false }));
    expect((await owner("office-visibility", { showFull: true })).status).toBe(503);
  });

  it("switches the representative route for the named case", async () => {
    api.rpc.mockResolvedValue(ok({ ok: true }));
    expect(await json(await owner("route-switch", { caseId }))).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect(api.rpc.mock.calls[0][1]).toEqual({ p_business: business, p_case: caseId });
  });

  it.each([
    ["PT409", 409],
    ["42501", 403],
    ["PT429", 429],
    ["XX000", 503],
  ])("maps database error %s to %i without echoing it", async (code, status) => {
    api.rpc.mockResolvedValue({ data: null, error: { code, message: `row ${caseId}` } });
    const response = await owner("renew", {});
    expect(response.status).toBe(status);
    expect(JSON.stringify(await response.json())).not.toContain(caseId);
  });

  it("refuses a write without CSRF before authenticating", async () => {
    expect((await handleNativeCipcOwnerAction(request({}, false), business, "renew")).status).toBe(
      403
    );
    expect(createFoundationRouteContext).not.toHaveBeenCalled();
  });

  it("asks a signed-out owner to sign in", async () => {
    authenticate.mockRejectedValueOnce(new FoundationSessionError(401));
    expect(await json(await owner("renew", {}))).toEqual({
      status: 401,
      body: { error: "Sign in to manage your CIPC registration check" },
    });
  });

  it("rate limits before authenticating", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ limited: true, retryAfter: 10 } as never);
    expect((await owner("renew", {})).status).toBe(429);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("refuses malformed JSON", async () => {
    expect((await owner("renew", "{")).status).toBe(400);
  });
});

describe("work email codes", () => {
  const send = {
    action: "send",
    caseId,
    email: " Ops@Example-Trading.co.za ",
    position: "Manager",
  };

  it("emails the code whose digest it stored, and never returns the code", async () => {
    service.rpc.mockResolvedValueOnce(ok({ challenge: nonce })).mockResolvedValueOnce(ok(true));
    const response = await owner("work-email", send);
    const { code, email } = vi.mocked(sendWorkEmailCode).mock.calls[0][0];
    expect(email).toBe("ops@example-trading.co.za");
    expect(service.rpc.mock.calls[0][1]).toMatchObject({
      p_owner: account,
      p_session: session,
      p_case: caseId,
      p_digest: hashCode(caseId, code),
    });
    expect(service.rpc.mock.calls[1][1]).toMatchObject({ p_challenge: nonce });
    const body = await response.json();
    expect(body).toEqual({ sent: true });
    expect(JSON.stringify(body)).not.toContain(code);
  });

  it("refuses a free-mail address before issuing a code", async () => {
    const response = await owner("work-email", { ...send, email: "owner@gmail.com" });
    expect(response.status).toBe(422);
    expect(service.rpc).not.toHaveBeenCalled();
    expect(sendWorkEmailCode).not.toHaveBeenCalled();
  });

  it("does not mark a code as sent when the email fails", async () => {
    service.rpc.mockResolvedValueOnce(ok({ challenge: nonce }));
    vi.mocked(sendWorkEmailCode).mockResolvedValue({ success: false } as never);
    expect((await owner("work-email", send)).status).toBe(503);
    expect(service.rpc).toHaveBeenCalledTimes(1);
  });

  it("fails when the sent acknowledgement is not confirmed", async () => {
    service.rpc.mockResolvedValueOnce(ok({ challenge: nonce })).mockResolvedValueOnce(ok(false));
    expect((await owner("work-email", send)).status).toBe(503);
  });

  it.each([
    [{ verified: true, remaining: 5 }, 200],
    [{ verified: false, remaining: 3 }, 400],
    [{ verified: false, remaining: 0 }, 429],
    [{ verified: true, remaining: 9 }, 503],
  ])("verifies a code against its digest (%o)", async (answer, status) => {
    service.rpc.mockResolvedValue(ok(answer));
    expect((await owner("work-email", { action: "verify", caseId, code: "123456" })).status).toBe(
      status
    );
    expect(service.rpc.mock.calls[0][1].p_digest).toBe(hashCode(caseId, "123456"));
  });

  it.each([
    ["a five-digit code", { action: "verify", caseId, code: "12345" }],
    ["an unexpected field", { action: "verify", caseId, code: "123456", accountId: source }],
    ["an unknown action", { action: "reset", caseId }],
  ])("refuses %s", async (_n, body) => {
    expect((await owner("work-email", body)).status).toBe(422);
    expect(service.rpc).not.toHaveBeenCalled();
  });
});

describe("staff CIPC commands", () => {
  const callback = {
    numberSource: "Company website",
    spokeTo: "Reception",
    confirmedPosition: "Manager",
    confirmed: true,
    notes: null,
  };
  const schema = z.union([
    z.strictObject({
      expectedUpdatedAt: z.string(),
      domainConfirmed: z.boolean(),
      callback: z.strictObject({
        numberSource: z.string(),
        spokeTo: z.string(),
        confirmedPosition: z.string(),
        confirmed: z.boolean(),
        notes: z.string().nullable(),
      }),
    }),
    z.strictObject({
      expectedUpdatedAt: z.string(),
      streetLines: z.array(z.string()),
      suburb: z.string().nullable(),
      city: z.string(),
      province: z.string(),
      postalCode: z.string().nullable(),
    }),
  ]);
  const at = "2026-11-11T10:00:00Z";
  const staff = (body: unknown) =>
    handleNativeCipcStaffAction(request(body), caseId, "representative", schema);

  it("records a call-back under the reviewer's current claim", async () => {
    api.rpc.mockResolvedValue(ok({ ok: true, confirmed: true }));
    expect((await staff({ expectedUpdatedAt: at, domainConfirmed: true, callback })).status).toBe(
      200
    );
    expect(currentBusinessClaim).toHaveBeenCalledWith(api, account, caseId, true);
    expect(api.rpc).toHaveBeenCalledWith(
      "record_frontend_cipc_callback",
      {
        p_case: caseId,
        p_expected: at,
        p_generation: "4",
        p_nonce: nonce,
        p_domain: true,
        p_callback: callback,
      },
      { get: false }
    );
  });

  it("corrects the office without passing the version field through", async () => {
    api.rpc.mockResolvedValue(ok({ ok: true }));
    const office = {
      streetLines: ["1 Main Road"],
      suburb: null,
      city: "Durban",
      province: "KwaZulu-Natal",
      postalCode: "4001",
    };
    expect((await staff({ expectedUpdatedAt: at, ...office })).status).toBe(200);
    expect(api.rpc.mock.calls[0]).toEqual([
      "correct_frontend_cipc_office",
      expect.objectContaining({ p_office: office }),
      { get: false },
    ]);
  });

  it.each([
    ["a non-ISO version", { expectedUpdatedAt: "yesterday", domainConfirmed: true, callback }, 422],
    [
      "an oversized body",
      {
        expectedUpdatedAt: at,
        domainConfirmed: true,
        callback: { ...callback, notes: "x".repeat(10001) },
      },
      400,
    ],
  ])("refuses %s", async (_n, body, status) => {
    expect((await staff(body)).status).toBe(status);
    expect(api.rpc).not.toHaveBeenCalled();
  });

  it("refuses when the reviewer no longer holds the claim", async () => {
    vi.mocked(currentBusinessClaim).mockRejectedValue(
      new FoundationStaffCommandError(409, "Claim this business check before continuing.")
    );
    expect((await staff({ expectedUpdatedAt: at, domainConfirmed: true, callback })).status).toBe(
      409
    );
    expect(api.rpc).not.toHaveBeenCalled();
  });
});
