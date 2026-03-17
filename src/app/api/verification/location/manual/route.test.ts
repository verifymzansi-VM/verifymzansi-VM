import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateClient, mockCheckRateLimit, mockGetClientIp } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockGetClientIp: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { POST } from "./route";

function createRequest(origin?: string) {
  return {
    url: "http://localhost/api/verification/location/manual",
    nextUrl: new URL("http://localhost/api/verification/location/manual"),
    headers: new Headers(origin ? { origin } : {}),
  } as unknown as NextRequest;
}

describe("POST /api/verification/location/manual", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
      },
    });
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockGetClientIp.mockReturnValue("127.0.0.1");
  });

  it("rejects cross-site manual location requests", async () => {
    const response = await POST(createRequest("https://evil.example"));
    expect(response.status).toBe(403);
  });

  it("returns 503 when shared manual location protection is unavailable", async () => {
    mockCheckRateLimit.mockResolvedValue({ limited: true, degraded: true, retryAfter: 40 });

    const response = await POST(createRequest("http://localhost"));
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("40");
  });
});
