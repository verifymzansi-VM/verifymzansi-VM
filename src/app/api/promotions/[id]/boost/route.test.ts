import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateClient, mockCreateAdminClient, mockCheckRateLimit, mockGetClientIp } = vi.hoisted(
  () => ({
    mockCreateClient: vi.fn(),
    mockCreateAdminClient: vi.fn(),
    mockCheckRateLimit: vi.fn(),
    mockGetClientIp: vi.fn(),
  })
);

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
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
    url: "https://verifymzansi.com/api/promotions/00000000-0000-0000-0000-000000000001/boost",
    headers: new Headers(origin ? { origin } : {}),
  } as unknown as NextRequest;
}

describe("POST /api/promotions/[id]/boost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAdminClient.mockReturnValue({ from: vi.fn() });
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    });
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockGetClientIp.mockReturnValue("127.0.0.1");
  });

  it("rejects cross-site boost checkout requests", async () => {
    const response = await POST(createRequest("https://evil.example"), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }),
    });

    expect(response.status).toBe(403);
  });

  it("returns 503 when shared checkout protection is degraded", async () => {
    mockCheckRateLimit.mockResolvedValue({ limited: true, degraded: true, retryAfter: 90 });

    const response = await POST(createRequest("https://verifymzansi.com"), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("90");
  });
});
