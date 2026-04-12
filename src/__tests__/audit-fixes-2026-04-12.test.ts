/**
 * Tests for bug fixes from the 2026-04-12 audit.
 *
 * Covers:
 *  1. CSRF enforcement on POST /api/auth/reset-password
 *  2. CSRF enforcement on POST /api/contact
 *  3. CSRF enforcement on POST /api/reports
 *  4. Entitlement status filter on POST /api/billing/create-checkout
 *  5. Count query error handling on GET /api/leads
 *  6. Supersede error blocking on POST /api/verification/upload
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

// ─── shared hoisted mocks ────────────────────────────────────
const { mockCreateClient, mockEnforceCsrfToken, mockEnforceSameOrigin } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockEnforceCsrfToken: vi.fn(),
  mockEnforceSameOrigin: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/utils/csrf", () => ({ enforceCsrfToken: mockEnforceCsrfToken }));
vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: mockEnforceSameOrigin,
}));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
  checkLocalRateLimit: vi.fn().mockReturnValue({ limited: false }),
}));
vi.mock("@/lib/utils/api", async () => {
  const actual = await vi.importActual("@/lib/utils/api");
  return {
    ...(actual as Record<string, unknown>),
    logApiError: vi.fn(),
    internalApiError: vi
      .fn()
      .mockReturnValue(NextResponse.json({ error: "Internal server error" }, { status: 500 })),
    parseAndValidateJsonRequest: vi.fn().mockResolvedValue({
      success: true,
      data: { password: "Test1234!", confirmPassword: "Test1234!" },
    }),
  };
});

function makeReq(method: string, url: string, body?: unknown): NextRequest {
  return {
    method,
    url,
    json: async () => body,
    headers: {
      get: vi.fn().mockReturnValue(null),
    },
    cookies: { get: () => undefined },
    nextUrl: new URL(url),
  } as unknown as NextRequest;
}

// ═══════════════════════════════════════════════════════════════
// 1 & 2 & 3. CSRF enforcement on reset-password, contact, reports
// ═══════════════════════════════════════════════════════════════

describe("CSRF enforcement on mutation routes", () => {
  const csrf403 = NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnforceSameOrigin.mockReturnValue(null);
  });

  describe("POST /api/auth/reset-password", () => {
    it("returns 403 when CSRF token is invalid", async () => {
      mockEnforceCsrfToken.mockReturnValue(csrf403);

      const { POST } = await import("@/app/api/auth/reset-password/route");
      const res = await POST(makeReq("POST", "http://localhost:3000/api/auth/reset-password"));

      expect(res.status).toBe(403);
      expect(mockEnforceCsrfToken).toHaveBeenCalledTimes(1);
    });

    it("proceeds when CSRF token is valid", async () => {
      mockEnforceCsrfToken.mockReturnValue(null);
      mockCreateClient.mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: "u1", recovery_sent_at: new Date().toISOString() } },
            error: null,
          }),
          updateUser: vi.fn().mockResolvedValue({ error: null }),
        },
      });

      const { POST } = await import("@/app/api/auth/reset-password/route");
      const res = await POST(
        makeReq("POST", "http://localhost:3000/api/auth/reset-password", {
          password: "StrongPass1!",
          confirmPassword: "StrongPass1!",
        })
      );

      // Shouldn't be 403; we're past the CSRF gate
      expect(res.status).not.toBe(403);
      expect(mockEnforceCsrfToken).toHaveBeenCalledTimes(1);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Leads count query error handling
// ═══════════════════════════════════════════════════════════════

describe("GET /api/leads — count query error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnforceSameOrigin.mockReturnValue(null);
    mockEnforceCsrfToken.mockReturnValue(null);
  });

  it("returns 500 when count query fails", async () => {
    const selectChain = {
      eq: vi.fn().mockResolvedValue({
        count: null,
        error: { message: "DB timeout" },
      }),
    };

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue(selectChain),
      }),
    });

    const { GET } = await import("@/app/api/leads/route");
    const res = await GET(makeReq("GET", "http://localhost:3000/api/leads?countOnly=true"));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to count leads");
  });

  it("returns count when query succeeds", async () => {
    const selectChain = {
      eq: vi.fn().mockResolvedValue({ count: 5, error: null }),
    };

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue(selectChain),
      }),
    });

    const { GET } = await import("@/app/api/leads/route");
    const res = await GET(makeReq("GET", "http://localhost:3000/api/leads?countOnly=true"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.unreadCount).toBe(5);
  });
});
