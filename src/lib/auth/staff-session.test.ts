import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";

const { createFoundationRouteContext, readFoundationRuntimeConnection, authenticateCaller } =
  vi.hoisted(() => ({
    createFoundationRouteContext: vi.fn(),
    readFoundationRuntimeConnection: vi.fn(),
    authenticateCaller: vi.fn(),
  }));
vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext }));
vi.mock("@/lib/foundation/runtime-connection", () => ({ readFoundationRuntimeConnection }));

import { FoundationSessionError } from "@/lib/foundation/request-api";
import { authenticateStaffRequest } from "./staff-session";

const accountId = "11111111-1111-4111-8111-111111111111";
const connection = { url: "https://example.supabase.co" };
const api = { rpc: vi.fn() };
const respond = vi.fn(async (response: NextResponse) => {
  response.headers.set("x-responded", "1");
  return response;
});
const request = (cookie?: string) =>
  new Request("https://verifymzansi.com/api/admin/x", {
    method: "POST",
    headers: cookie ? { cookie } : {},
  });

describe("authenticateStaffRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readFoundationRuntimeConnection.mockReturnValue(connection);
    createFoundationRouteContext.mockReturnValue({ authenticateCaller, respond });
    authenticateCaller.mockResolvedValue({
      api,
      accountId,
      sessionId: "22222222-2222-4222-8222-222222222222",
      user: { id: accountId },
      authenticatorAt: 1_790_000_000,
    });
  });

  it("returns the Auth-verified caller and its authenticator time", async () => {
    const result = await authenticateStaffRequest(request());
    expect(result).toEqual({
      ok: true,
      respond,
      caller: { api, accountId, user: { id: accountId }, authenticatorAt: 1_790_000_000 },
    });
    expect(createFoundationRouteContext).toHaveBeenCalledWith(connection, expect.anything());
  });

  it("reads the session cookies of a plain Request without its body", async () => {
    const plain = request("sb-x-auth-token=abc; other=1");
    await authenticateStaffRequest(plain);
    const [, cookies] = createFoundationRouteContext.mock.calls[0];
    expect(cookies.cookies.getAll()).toEqual([
      { name: "sb-x-auth-token", value: "abc" },
      { name: "other", value: "1" },
    ]);
    expect(plain.bodyUsed).toBe(false);
  });

  it("uses a Next.js request's own cookies", async () => {
    const next = new NextRequest("https://verifymzansi.com/api/admin/x", {
      headers: { cookie: "a=1" },
    });
    await authenticateStaffRequest(next);
    expect(createFoundationRouteContext).toHaveBeenCalledWith(connection, {
      cookies: next.cookies,
    });
  });

  it("refuses a signed-out, revoked or forged session with 401", async () => {
    authenticateCaller.mockRejectedValue(new FoundationSessionError(401));
    const result = await authenticateStaffRequest(request());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    expect(result.response.headers.get("x-responded")).toBe("1");
  });

  it("refuses a caller whose verified user is not the token subject", async () => {
    authenticateCaller.mockResolvedValue({
      api,
      accountId,
      user: { id: "33333333-3333-4333-8333-333333333333" },
      authenticatorAt: null,
    });
    const result = await authenticateStaffRequest(request());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it.each([
    ["Auth is unavailable", new FoundationSessionError(503)],
    ["an unexpected error", new Error("boom")],
  ])("fails closed with 503 when %s", async (_label, error) => {
    authenticateCaller.mockRejectedValue(error);
    const result = await authenticateStaffRequest(request());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(503);
  });

  it("fails closed with 503 when the live backend binding is missing", async () => {
    readFoundationRuntimeConnection.mockImplementation(() => {
      throw new Error("Unapproved foundation runtime project");
    });
    const result = await authenticateStaffRequest(request());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(503);
    expect(authenticateCaller).not.toHaveBeenCalled();
  });
});
