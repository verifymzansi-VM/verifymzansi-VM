import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateAdminClient, mockCheckRateLimit, mockLoggerError, mockEnforceCsrfToken } =
  vi.hoisted(() => ({
    mockCreateAdminClient: vi.fn(),
    mockCheckRateLimit: vi.fn().mockResolvedValue({ limited: false }),
    mockLoggerError: vi.fn(),
    mockEnforceCsrfToken: vi.fn().mockReturnValue(null),
  }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ error: mockLoggerError, info: vi.fn(), warn: vi.fn() }),
}));

vi.mock("@/lib/utils/csrf", () => ({
  enforceCsrfToken: mockEnforceCsrfToken,
}));

import { POST } from "@/app/api/verify-buyer/route";

function createRequest(body: unknown): NextRequest {
  const headers = new Headers({
    origin: "http://localhost:3000",
    "sec-fetch-site": "same-origin",
  });

  return {
    method: "POST",
    json: async () => body,
    headers,
    url: "http://localhost:3000/api/verify-buyer",
    nextUrl: new URL("http://localhost:3000/api/verify-buyer"),
  } as unknown as NextRequest;
}

describe("POST /api/verify-buyer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockEnforceCsrfToken.mockReturnValue(null);
  });

  it("returns 429 when buyer verification attempts are rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue({ limited: true, retryAfter: 90 });

    const response = await POST(createRequest({ token: "00000000-0000-4000-8000-000000000001" }));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("90");
    await expect(response.json()).resolves.toEqual({
      error: "Too many verification attempts. Please try again later.",
    });
  });

  it("rejects malformed buyer tokens", async () => {
    const response = await POST(createRequest({ token: "bad-token" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid token",
    });
  });

  it("returns a safe error when the verification lookup fails", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "db exploded with secrets" },
        }),
      }),
    });

    const response = await POST(createRequest({ token: "00000000-0000-4000-8000-000000000001" }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to verify token",
    });
    expect(mockLoggerError).toHaveBeenCalledWith("Failed to verify buyer token", {
      error: "db exploded with secrets",
    });
  });

  it("returns valid buyer details for active verifications", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            first_name_initial: "N.",
            issued_at: "2026-03-10T12:00:00.000Z",
            expires_at: "2026-04-20T12:00:00.000Z",
            status: "valid",
          },
          error: null,
        }),
      }),
    });

    const response = await POST(createRequest({ token: "00000000-0000-4000-8000-000000000001" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      result: "valid",
      buyerInfo: {
        displayName: "N.",
        verifiedAt: "2026-03-10T12:00:00.000Z",
      },
    });
  });

  it("returns expired when an otherwise valid token is past its expiry date", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            first_name_initial: "N.",
            issued_at: "2026-03-10T12:00:00.000Z",
            expires_at: "2026-03-01T12:00:00.000Z",
            status: "valid",
          },
          error: null,
        }),
      }),
    });

    const response = await POST(createRequest({ token: "00000000-0000-4000-8000-000000000001" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      result: "expired",
    });
  });

  it("rejects cross-site verification requests", async () => {
    const request = createRequest({ token: "00000000-0000-4000-8000-000000000001" });
    request.headers.set("origin", "https://evil.example");
    request.headers.set("sec-fetch-site", "cross-site");

    const response = await POST(request);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Cross-site requests are not allowed",
    });
  });

  it("rejects requests with a missing or invalid CSRF token", async () => {
    mockEnforceCsrfToken.mockReturnValue(
      new Response(JSON.stringify({ error: "Missing CSRF token" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );

    const response = await POST(createRequest({ token: "00000000-0000-4000-8000-000000000001" }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Missing CSRF token" });
  });
});
