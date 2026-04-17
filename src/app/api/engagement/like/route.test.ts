import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockCheckLocalRateLimit,
  mockGetClientRateLimitKey,
  mockEnforceSameOriginMutation,
  mockLogger,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockCheckLocalRateLimit: vi.fn(),
  mockGetClientRateLimitKey: vi.fn(),
  mockEnforceSameOriginMutation: vi.fn(() => null),
  mockLogger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
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
  createLogger: () => mockLogger,
}));

import { POST } from "./route";

function createRequest(body: unknown, viewerCookie?: string): NextRequest {
  return {
    text: async () => JSON.stringify(body),
    headers: {
      get: () => null,
    },
    cookies: {
      get: (name: string) =>
        name === "vmz_viewer" && viewerCookie ? { value: viewerCookie } : null,
    },
    url: "http://localhost:3000/api/engagement/like",
    nextUrl: new URL("http://localhost:3000/api/engagement/like"),
  } as unknown as NextRequest;
}

describe("POST /api/engagement/like", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnforceSameOriginMutation.mockReturnValue(null);
    mockCheckLocalRateLimit.mockReturnValue({ limited: false });
    mockGetClientRateLimitKey.mockReturnValue("client-key");
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });
  });

  it("toggles likes and returns the authoritative like count", async () => {
    mockCreateAdminClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: [{ liked: true, like_count: 3 }],
        error: null,
      }),
    });

    const response = await POST(
      createRequest({
        targetId: "00000000-0000-0000-0000-000000000123",
        targetType: "listing",
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ liked: true, likeCount: 3 });
    expect(response.headers.get("set-cookie")).toContain("vmz_viewer=");
  });

  it("returns 500 when the toggle_content_like rpc fails", async () => {
    mockCreateAdminClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "rpc failed" },
      }),
    });

    const response = await POST(
      createRequest(
        {
          targetId: "00000000-0000-0000-0000-000000000123",
          targetType: "listing",
        },
        "viewer-1"
      )
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Failed to update like" });
  });
});
