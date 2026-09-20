import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockCheckLocalRateLimit,
  mockGetClientRateLimitKey,
  mockEnforceSameOriginMutation,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockCheckLocalRateLimit: vi.fn(),
  mockGetClientRateLimitKey: vi.fn(),
  mockEnforceSameOriginMutation: vi.fn<() => Response | null>(() => null),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: mockCheckLocalRateLimit,
  getClientRateLimitKey: mockGetClientRateLimitKey,
}));

vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: mockEnforceSameOriginMutation,
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn() }),
}));

import { POST } from "./route";

function createRequest(body: unknown, viewerCookie?: string): NextRequest {
  return {
    text: async () => JSON.stringify(body),
    headers: { get: () => null },
    cookies: {
      get: (name: string) =>
        name === "vmz_viewer" && viewerCookie ? { value: viewerCookie } : null,
    },
    url: "http://localhost:3000/api/analytics/visit",
    nextUrl: new URL("http://localhost:3000/api/analytics/visit"),
  } as unknown as NextRequest;
}

describe("POST /api/analytics/visit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnforceSameOriginMutation.mockReturnValue(null);
    mockCheckLocalRateLimit.mockReturnValue({ limited: false });
    mockGetClientRateLimitKey.mockReturnValue("client-key");
    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });
    mockCreateAdminClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    });
  });

  it("records a visit and sets the viewer cookie for new visitors", async () => {
    const response = await POST(createRequest({ path: "/mzansi-market", referrer: null }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, recorded: true });
    expect(response.headers.get("set-cookie")).toContain("vmz_viewer=");
  });

  it("passes path, viewer key, and origin-only referrer to the RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    mockCreateAdminClient.mockReturnValue({ rpc });
    const getUser = vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockCreateClient.mockResolvedValue({ auth: { getUser } });

    await POST(
      createRequest({ path: "/", referrer: "https://google.com/search?q=cars" }, "device-9")
    );

    expect(rpc).toHaveBeenCalledWith(
      "record_site_visit",
      expect.objectContaining({
        p_path: "/",
        p_referrer: "https://google.com",
        p_viewer_key: "anon:device-9",
        p_user_id: "user-1",
      })
    );
  });

  it("does not record admin or api paths", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    mockCreateAdminClient.mockReturnValue({ rpc });

    const response = await POST(createRequest({ path: "/admin" }));
    await expect(response.json()).resolves.toEqual({ ok: true, recorded: false });
    expect(rpc).not.toHaveBeenCalled();

    const apiResp = await POST(createRequest({ path: "/api/health" }));
    await expect(apiResp.json()).resolves.toEqual({ ok: true, recorded: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    "/verification",
    "/dashboard",
    "/billing",
    "/dsar",
    "/post/create",
    "/login",
    "/mzansi-market/private",
    "/?secret=x",
  ])("ignores non-public path %s", async (path) => {
    const response = await POST(createRequest({ path }));
    expect(await response.json()).toEqual({ ok: true, recorded: false });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("honors the DNT request header", async () => {
    const request = createRequest({ path: "/" });
    Object.defineProperty(request, "headers", { value: new Headers({ dnt: "1" }) });
    expect(await (await POST(request)).json()).toEqual({ ok: true, recorded: false });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("fails soft when the RPC errors (never breaks page loads)", async () => {
    mockCreateAdminClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
    });

    const response = await POST(createRequest({ path: "/mzansi-business" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, recorded: false });
  });

  it("blocks cross-site mutations", async () => {
    mockEnforceSameOriginMutation.mockReturnValue(
      new Response(JSON.stringify({ error: "Cross-site" }), { status: 403 })
    );

    const response = await POST(createRequest({ path: "/" }));
    expect(response.status).toBe(403);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });
});
