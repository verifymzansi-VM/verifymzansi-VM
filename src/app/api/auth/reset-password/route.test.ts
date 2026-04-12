import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const {
  mockCreateClient,
  mockCheckRateLimit,
  mockGetClientIp,
  mockEnforceSameOriginMutation,
  mockLogger,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockGetClientIp: vi.fn(),
  mockEnforceSameOriginMutation: vi.fn<(request: NextRequest) => Response | null>(() => null),
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: mockGetClientIp,
}));

vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: mockEnforceSameOriginMutation,
}));

vi.mock("@/lib/utils/csrf", () => ({
  enforceCsrfToken: vi.fn(() => null),
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => mockLogger,
}));

import { GET, POST } from "./route";

function createRequest(body: unknown): NextRequest {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return {
    method: "POST",
    text: async () => payload,
    url: "https://verifymzansi.com/api/auth/reset-password",
    nextUrl: new URL("https://verifymzansi.com/api/auth/reset-password"),
    headers: {
      get: () => null,
    },
  } as unknown as NextRequest;
}

function createSupabaseAuthClient(overrides?: {
  user?: Record<string, unknown> | null;
  getUserError?: { message: string } | null;
  updateUserError?: { message: string } | null;
}) {
  const user =
    overrides && Object.prototype.hasOwnProperty.call(overrides, "user")
      ? overrides.user
      : { id: "user-1", recovery_sent_at: new Date().toISOString() };

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: overrides?.getUserError ?? null,
      }),
      updateUser: vi.fn().mockResolvedValue({
        error: overrides?.updateUserError ?? null,
      }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  };
}

describe("GET /api/auth/reset-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns valid:false when session user is missing", async () => {
    mockCreateClient.mockResolvedValue(createSupabaseAuthClient({ user: null }));

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ valid: false });
  });

  it("returns valid:false when recovery timestamp is stale", async () => {
    const stale = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    mockCreateClient.mockResolvedValue(
      createSupabaseAuthClient({ user: { id: "user-1", recovery_sent_at: stale } })
    );

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ valid: false });
  });

  it("returns valid:true when recovery session is recent", async () => {
    const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    mockCreateClient.mockResolvedValue(
      createSupabaseAuthClient({ user: { id: "user-1", recovery_sent_at: recent } })
    );

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ valid: true });
  });

  it("returns 500 when session check throws", async () => {
    mockCreateClient.mockRejectedValue(new Error("boom"));

    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Internal server error" });
    expect(mockLogger.error).toHaveBeenCalled();
  });
});

describe("POST /api/auth/reset-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnforceSameOriginMutation.mockReturnValue(null);
    mockGetClientIp.mockReturnValue("127.0.0.1");
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockCreateClient.mockResolvedValue(createSupabaseAuthClient());
  });

  it("rejects cross-origin requests before rate-limit", async () => {
    mockEnforceSameOriginMutation.mockReturnValue(
      new Response(JSON.stringify({ error: "Cross-origin request blocked" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );

    const response = await POST(
      createRequest({ password: "NewPassword123!", confirmPassword: "NewPassword123!" })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Cross-origin request blocked" });
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });

  it("returns 503 when limiter is degraded and limited", async () => {
    mockCheckRateLimit.mockResolvedValue({ limited: true, degraded: true, retryAfter: 30 });

    const response = await POST(
      createRequest({ password: "NewPassword123!", confirmPassword: "NewPassword123!" })
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
  });

  it("returns 429 when limiter is not degraded", async () => {
    mockCheckRateLimit.mockResolvedValue({ limited: true, degraded: false, retryAfter: 20 });

    const response = await POST(
      createRequest({ password: "NewPassword123!", confirmPassword: "NewPassword123!" })
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("20");
    await expect(response.json()).resolves.toEqual({
      error: "Too many attempts. Please try again later.",
    });
  });

  it("returns 401 when reset session is missing", async () => {
    mockCreateClient.mockResolvedValue(createSupabaseAuthClient({ user: null }));

    const response = await POST(
      createRequest({ password: "NewPassword123!", confirmPassword: "NewPassword123!" })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Your reset link has expired or is invalid. Please request a new one.",
    });
  });

  it("returns 400 for invalid payload", async () => {
    const response = await POST(createRequest("{ bad-json"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid JSON payload" });
  });

  it("returns 401 when updateUser reports expired token/session", async () => {
    mockCreateClient.mockResolvedValue(
      createSupabaseAuthClient({ updateUserError: { message: "Session expired token" } })
    );

    const response = await POST(
      createRequest({ password: "NewPassword123!", confirmPassword: "NewPassword123!" })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Your reset link has expired. Please request a new one.",
    });
  });

  it("returns 500 when updateUser fails for generic reason", async () => {
    mockCreateClient.mockResolvedValue(
      createSupabaseAuthClient({ updateUserError: { message: "db write failed" } })
    );

    const response = await POST(
      createRequest({ password: "NewPassword123!", confirmPassword: "NewPassword123!" })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to update password. Please try again.",
    });
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("updates password and signs out on success", async () => {
    const client = createSupabaseAuthClient();
    mockCreateClient.mockResolvedValue(client);

    const response = await POST(
      createRequest({ password: "NewPassword123!", confirmPassword: "NewPassword123!" })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(client.auth.updateUser).toHaveBeenCalledWith({ password: "NewPassword123!" });
    expect(client.auth.signOut).toHaveBeenCalled();
  });

  it("returns 500 on unexpected exception", async () => {
    mockCreateClient.mockRejectedValue(new Error("unexpected crash"));

    const response = await POST(
      createRequest({ password: "NewPassword123!", confirmPassword: "NewPassword123!" })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Internal server error" });
  });
});
