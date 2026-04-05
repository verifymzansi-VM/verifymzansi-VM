import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockCheckRateLimit,
  mockGetClientIp,
  mockEnforceSameOriginMutation,
  mockEnforceCsrfToken,
  mockLogger,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockGetClientIp: vi.fn(),
  mockEnforceSameOriginMutation: vi.fn<(request: NextRequest) => Response | null>(() => null),
  mockEnforceCsrfToken: vi.fn<(request: NextRequest) => Response | null>(() => null),
  mockLogger: {
    info: vi.fn(),
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
  checkRateLimit: mockCheckRateLimit,
  getClientIp: mockGetClientIp,
}));

vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: mockEnforceSameOriginMutation,
}));

vi.mock("@/lib/utils/csrf", () => ({
  enforceCsrfToken: mockEnforceCsrfToken,
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => mockLogger,
}));

import { POST } from "./route";

function createRequest(body: unknown): NextRequest {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return {
    text: async () => payload,
    headers: {
      get: () => null,
    },
    url: "http://localhost:3000/api/account/email/change",
    nextUrl: new URL("http://localhost:3000/api/account/email/change"),
  } as unknown as NextRequest;
}

function makeDefaultSupabaseClient() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-1", email: "old@example.com" } },
        error: null,
      }),
      updateUser: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { contact_last_email_change_at: null },
            error: null,
          }),
        }),
      }),
    }),
  };
}

function makeDefaultAdminClient() {
  return {
    from: vi.fn((table: string) => {
      if (table === "account_profiles") {
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      if (table === "contact_change_history") {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return {
        insert: vi.fn().mockResolvedValue({ error: null }),
      };
    }),
  };
}

describe("POST /api/account/email/change", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnforceSameOriginMutation.mockReturnValue(null);
    mockEnforceCsrfToken.mockReturnValue(null);
    mockGetClientIp.mockReturnValue("127.0.0.1");
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockCreateClient.mockResolvedValue(makeDefaultSupabaseClient());
    mockCreateAdminClient.mockReturnValue(makeDefaultAdminClient());
  });

  it("rejects cross-origin requests before downstream calls", async () => {
    mockEnforceSameOriginMutation.mockReturnValue(
      new Response(JSON.stringify({ error: "Cross-origin request blocked" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );

    const response = await POST(createRequest({ newEmail: "new@example.com" }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Cross-origin request blocked" });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("rejects invalid csrf token before rate limit check", async () => {
    mockEnforceCsrfToken.mockReturnValue(
      new Response(JSON.stringify({ error: "Invalid CSRF token" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );

    const response = await POST(createRequest({ newEmail: "new@example.com" }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Invalid CSRF token" });
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });

  it("returns 429 with retry-after when rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue({ limited: true, retryAfter: 45 });

    const response = await POST(createRequest({ newEmail: "new@example.com" }));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("45");
    await expect(response.json()).resolves.toEqual({
      error: "Too many requests. Please try again later.",
    });
  });

  it("returns 401 when auth user cannot be resolved", async () => {
    const client = makeDefaultSupabaseClient();
    client.auth.getUser = vi
      .fn()
      .mockResolvedValue({ data: { user: null }, error: { message: "not authenticated" } });
    mockCreateClient.mockResolvedValue(client);

    const response = await POST(createRequest({ newEmail: "new@example.com" }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Authentication required" });
  });

  it("returns 400 for invalid json payload", async () => {
    const response = await POST(createRequest("{ not-valid-json"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid JSON payload" });
  });

  it("returns 400 for invalid email validation", async () => {
    const response = await POST(createRequest({ newEmail: "invalid-email" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid request" });
  });

  it("returns 422 when email equals current user email", async () => {
    const response = await POST(createRequest({ newEmail: "OLD@example.com" }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "This is already your current email address.",
    });
  });

  it("returns 500 when profile cooldown fetch fails", async () => {
    const client = makeDefaultSupabaseClient();
    client.from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "db unavailable" },
          }),
        }),
      }),
    });
    mockCreateClient.mockResolvedValue(client);

    const response = await POST(createRequest({ newEmail: "new@example.com" }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Internal server error" });
  });

  it("returns cooldown 429 when email change is still locked", async () => {
    const recentIso = new Date(Date.now() - 60_000).toISOString();
    const client = makeDefaultSupabaseClient();
    client.from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { contact_last_email_change_at: recentIso },
            error: null,
          }),
        }),
      }),
    });
    mockCreateClient.mockResolvedValue(client);

    const response = await POST(createRequest({ newEmail: "new@example.com" }));

    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.code).toBe("EMAIL_COOLDOWN");
    expect(typeof body.retryAfter).toBe("string");
  });

  it("returns 409 when supabase reports email already registered", async () => {
    const client = makeDefaultSupabaseClient();
    client.auth.updateUser = vi
      .fn()
      .mockResolvedValue({ error: { message: "Email already registered" } });
    mockCreateClient.mockResolvedValue(client);

    const response = await POST(createRequest({ newEmail: "new@example.com" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "That email address is already in use by another account.",
    });
  });

  it("returns 500 for non-conflict email update failures", async () => {
    const client = makeDefaultSupabaseClient();
    client.auth.updateUser = vi.fn().mockResolvedValue({ error: { message: "unexpected" } });
    mockCreateClient.mockResolvedValue(client);

    const response = await POST(createRequest({ newEmail: "new@example.com" }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to initiate email change. Please try again.",
    });
  });

  it("returns success and writes cooldown + audit on valid request", async () => {
    const response = await POST(createRequest({ newEmail: "new@example.com" }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(String(body.message)).toContain("Confirmation email sent");

    expect(mockCreateAdminClient).toHaveBeenCalledTimes(1);
  });

  it("still returns success when admin side effects reject", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "account_profiles") {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockRejectedValue(new Error("profile update failed")),
            }),
          };
        }
        if (table === "contact_change_history") {
          return {
            insert: vi.fn().mockRejectedValue(new Error("audit insert failed")),
          };
        }
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }),
    });

    const response = await POST(createRequest({ newEmail: "new@example.com" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        success: true,
      })
    );
    expect(mockLogger.error).toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it("returns 500 when an unexpected exception is thrown", async () => {
    mockCreateClient.mockRejectedValue(new Error("boom"));

    const response = await POST(createRequest({ newEmail: "new@example.com" }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Internal server error" });
  });
});
