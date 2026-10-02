import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockCheckLocalRateLimit,
  mockGetClientRateLimitKey,
  mockGetClientIp,
  mockEnforceSameOriginMutation,
  mockResolveIpGeolocation,
  mockLogger,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockCheckLocalRateLimit: vi.fn(),
  mockGetClientRateLimitKey: vi.fn(),
  mockGetClientIp: vi.fn(),
  mockEnforceSameOriginMutation: vi.fn(() => null),
  mockResolveIpGeolocation: vi.fn(),
  mockLogger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: mockCheckLocalRateLimit,
  getClientRateLimitKey: mockGetClientRateLimitKey,
  getClientIp: mockGetClientIp,
}));

vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: mockEnforceSameOriginMutation,
}));

vi.mock("@/lib/services/ip-geolocation", () => ({
  resolveIpGeolocation: mockResolveIpGeolocation,
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => mockLogger,
}));

import { POST } from "./route";

const BROWSER =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const ID = "00000000-0000-0000-0000-000000000123";

function createRequest(body: unknown, viewerCookie?: string, userAgent = BROWSER): NextRequest {
  return {
    text: async () => JSON.stringify(body),
    headers: {
      get: (name: string) => (name.toLowerCase() === "user-agent" ? userAgent : null),
    },
    cookies: {
      get: (name: string) =>
        name === "vmz_viewer" && viewerCookie ? { value: viewerCookie } : null,
    },
    url: "http://localhost:3000/api/engagement/view",
    nextUrl: new URL("http://localhost:3000/api/engagement/view"),
  } as unknown as NextRequest;
}

const videoView = {
  events: [{ type: "listing", id: ID, source: "video", surface: "showroom:home" }],
};

describe("POST /api/engagement/view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnforceSameOriginMutation.mockReturnValue(null);
    mockCheckLocalRateLimit.mockReturnValue({ limited: false });
    mockGetClientRateLimitKey.mockReturnValue("client-key");
    mockGetClientIp.mockReturnValue("196.1.2.3");
    mockResolveIpGeolocation.mockResolvedValue({ country: "ZA", province: "Gauteng" });
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });
  });

  it("returns the counted posts and sets the viewer cookie for a new browser", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [ID], error: null });
    mockCreateAdminClient.mockReturnValue({ rpc });

    const response = await POST(createRequest(videoView));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, counted: [ID] });
    expect(response.headers.get("set-cookie")).toContain("vmz_viewer=");
    expect(rpc).toHaveBeenCalledWith(
      "record_content_views",
      expect.objectContaining({
        p_events: videoView.events,
        p_viewer_key: expect.stringMatching(/^device:/),
        p_province: "Gauteng",
        p_user_id: null,
      })
    );
  });

  it("keeps the device identity across login and never stores the raw IP", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    mockCreateAdminClient.mockReturnValue({ rpc });
    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "owner-1" } } }) },
    });

    await POST(createRequest(videoView, "same-device"));

    const args = rpc.mock.calls[0][1];
    expect(args.p_viewer_key).toBe("device:same-device");
    expect(args.p_user_id).toBe("owner-1");
    expect(args.p_ip_hash).toMatch(/^[0-9a-f]{40}$/);
    expect(JSON.stringify(args)).not.toContain("196.1.2.3");
  });

  it("ignores crawlers and headless browsers without touching the database", async () => {
    const response = await POST(
      createRequest(videoView, "viewer-1", "Mozilla/5.0 (compatible; Googlebot/2.1)")
    );
    await expect(response.json()).resolves.toEqual({ ok: true, counted: [] });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("only passes a province for South African connections", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    mockCreateAdminClient.mockReturnValue({ rpc });
    mockResolveIpGeolocation.mockResolvedValue({ country: "GB", province: null });
    await POST(createRequest(videoView, "viewer-1"));
    expect(rpc.mock.calls[0][1].p_province).toBeNull();
  });

  it("returns 500 when the record_content_views rpc fails", async () => {
    mockCreateAdminClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "rpc failed" } }),
    });
    const response = await POST(createRequest(videoView, "viewer-1"));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Failed to record view" });
  });

  it.each([
    [{ events: [{ type: "listing", id: "not-a-uuid", source: "video" }] }],
    [{ events: [{ type: "listing", id: ID, source: "scroll" }] }],
    [{ events: [{ type: "user", id: ID, source: "page" }] }],
    [{ events: [] }],
    [{ targetId: ID, targetType: "listing" }],
  ])("rejects malformed batches before writing a view", async (body) => {
    const response = await POST(createRequest(body, "viewer-1"));
    expect(response.status).toBe(400);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });
});
