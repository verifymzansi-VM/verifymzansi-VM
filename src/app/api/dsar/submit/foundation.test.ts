/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST } from "./route";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import { verifyTurnstileToken } from "@/lib/utils/turnstile";

vi.mock("@/lib/foundation/owner-route", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  handleFoundationOwnerRoute: vi.fn(),
}));
vi.mock("@/lib/foundation/service-api", () => ({ createFoundationServiceApi: vi.fn() }));
vi.mock("@/lib/utils/turnstile", () => ({ verifyTurnstileToken: vi.fn() }));
vi.mock("@/lib/utils/rate-limit", () => ({ getClientIp: () => "198.51.100.7" }));

type OwnerRouteOptions = Parameters<typeof handleFoundationOwnerRoute>[0];

const caller = { accountId: "00000000-0000-4000-8000-000000000001", sessionId: "session" };
const requestId = "00000000-0000-4000-8000-000000000002";
const answer = NextResponse.json({ ok: true });
const serviceRpc = vi.fn();
const api = {} as Parameters<OwnerRouteOptions["command"]>[0];
const body = {
  type: "access",
  name: " Thandi Mokoena ",
  email: "thandi@example.com",
  idNumber: "8001015009087",
  details: "  ",
  turnstileToken: "token",
};

async function submitOptions() {
  const request = new NextRequest("https://verifymzansi.com/api/dsar/submit", { method: "POST" });
  expect(await POST(request)).toBe(answer);
  const options = vi.mocked(handleFoundationOwnerRoute).mock.calls[0][0] as OwnerRouteOptions;
  expect(options).toMatchObject({
    request,
    action: "dsar:submit",
    mutate: true,
    requireCaller: true,
    maxBytes: 15000,
  });
  return options;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.mocked(handleFoundationOwnerRoute).mockResolvedValue(answer);
  vi.mocked(verifyTurnstileToken).mockResolvedValue({
    success: true,
    hostname: "verifymzansi.com",
  } as never);
  vi.mocked(createFoundationServiceApi).mockReturnValue({ rpc: serviceRpc } as never);
  serviceRpc.mockResolvedValue({
    data: { id: requestId, due_by: "2026-12-11T08:00:00+00:00" },
    error: null,
  });
});
afterEach(() => vi.unstubAllEnvs());

// handleFoundationOwnerRoute owns CSRF, sign-in and the body limit (tested in
// src/lib/foundation/owner-route.test.ts).
describe("POST /api/dsar/submit on foundation", () => {
  it("records the request for the signed-in account after the CAPTCHA passes", async () => {
    const { command } = await submitOptions();
    await expect(command(api, body, caller)).resolves.toEqual({
      success: true,
      requestId,
      reference: "DSAR-00000000",
      dueBy: "2026-12-11T08:00:00.000Z",
    });
    expect(verifyTurnstileToken).toHaveBeenCalledWith({
      token: "token",
      remoteIp: "198.51.100.7",
    });
    expect(serviceRpc).toHaveBeenCalledExactlyOnceWith(
      "record_frontend_privacy_request",
      {
        p_account: caller.accountId,
        p_session: "session",
        p_type: "access",
        p_name: "Thandi Mokoena",
        p_last_four: "9087",
        p_details: null,
      },
      { get: false }
    );
  });

  it("refuses a failed, unavailable or foreign-host CAPTCHA before recording", async () => {
    const { command, refusal } = await submitOptions();
    for (const [captcha, status] of [
      [{ success: false }, 400],
      [{ success: false, temporary: true }, 503],
      [{ success: true, hostname: "example.com" }, 400],
    ] as const) {
      vi.mocked(verifyTurnstileToken).mockResolvedValueOnce(captcha as never);
      const error = await command(api, body, caller).catch((e: unknown) => e);
      expect(refusal(error)).toMatchObject({ status, reason: "privacy_submission_refused" });
    }
    expect(serviceRpc).not.toHaveBeenCalled();
  });

  it("maps database refusals and rejects invalid or anonymous submissions", async () => {
    const { command, refusal } = await submitOptions();
    for (const [code, status] of [
      ["42501", 403],
      ["22023", 400],
      ["PT429", 429],
    ] as const) {
      serviceRpc.mockResolvedValueOnce({ data: null, error: { code } });
      const error = await command(api, body, caller).catch((e: unknown) => e);
      expect(refusal(error)).toMatchObject({ status });
    }
    serviceRpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    const unavailable = await command(api, body, caller).catch((e: unknown) => e);
    expect(refusal(unavailable)).toBeNull();
    serviceRpc.mockResolvedValueOnce({ data: { id: "nope" }, error: null });
    await expect(command(api, body, caller)).rejects.toThrow("receipt unavailable");

    const invalid = await command(api, { ...body, idNumber: "123" }, caller).catch(
      (e: unknown) => e
    );
    expect(refusal(invalid)).toMatchObject({ status: 422, reason: "invalid_privacy_request" });
    await expect(command(api, body)).rejects.toThrow("Verified privacy caller required");
  });
});
