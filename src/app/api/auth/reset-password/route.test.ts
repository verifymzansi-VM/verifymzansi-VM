import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import type { NextRequest } from "next/server";

const {
  mockCreateClient,
  mockCheckRateLimit,
  mockGetClientIp,
  mockEnforceSameOriginMutation,
  mockIsPwnedPassword,
  mockSendPasswordChangeNotification,
  mockLogger,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockGetClientIp: vi.fn(),
  mockEnforceSameOriginMutation: vi.fn<(request: NextRequest) => Response | null>(() => null),
  mockIsPwnedPassword: vi.fn().mockResolvedValue(false),
  mockSendPasswordChangeNotification: vi.fn().mockResolvedValue({ success: true }),
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
vi.mock("@/lib/security/pwned-passwords", () => ({
  isPwnedPassword: mockIsPwnedPassword,
  PWNED_PASSWORD_ERROR:
    "This password has appeared in a known data breach. Choose a different password.",
  PWNED_PASSWORD_CHECK_UNAVAILABLE_ERROR:
    "Password breach checks are temporarily unavailable. Please try again shortly.",
}));

vi.mock("@/lib/services/email", () => ({
  sendPasswordChangeNotification: mockSendPasswordChangeNotification,
}));

import { GET, POST } from "./route";
import { createRecoveryProof } from "@/lib/auth/password-recovery";

function createRequest(body: unknown, cookieValues: Record<string, string> = {}): NextRequest {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return {
    method: "POST",
    text: async () => payload,
    url: "https://verifymzansi.com/api/auth/reset-password",
    nextUrl: new URL("https://verifymzansi.com/api/auth/reset-password"),
    cookies: {
      get: (name: string) =>
        cookieValues[name] === undefined ? undefined : { name, value: cookieValues[name] },
    },
    headers: {
      get: () => null,
    },
  } as unknown as NextRequest;
}

function createGetRequest(cookieValues: Record<string, string> = {}): NextRequest {
  return {
    method: "GET",
    url: "https://verifymzansi.com/api/auth/reset-password",
    nextUrl: new URL("https://verifymzansi.com/api/auth/reset-password"),
    cookies: {
      get: (name: string) =>
        cookieValues[name] === undefined ? undefined : { name, value: cookieValues[name] },
    },
    headers: {
      get: () => null,
    },
  } as unknown as NextRequest;
}

function createSupabaseAuthClient(overrides?: {
  user?: Record<string, unknown> | null;
  getUserError?: { message: string } | null;
  updateUserError?: { message: string } | null;
  amr?: Array<string | { method: string; timestamp: number }>;
}) {
  const user =
    overrides && Object.prototype.hasOwnProperty.call(overrides, "user")
      ? overrides.user
      : { id: "user-1", email: "user@example.com", recovery_sent_at: new Date().toISOString() };

  return {
    auth: {
      getClaims: vi.fn().mockResolvedValue({
        data: {
          claims: {
            sub: user?.id,
            session_id: "session-1",
            amr:
              overrides?.amr ??
              (user?.recovery_sent_at
                ? [
                    {
                      method: "recovery",
                      timestamp: Math.floor(
                        new Date(String(user.recovery_sent_at)).getTime() / 1000
                      ),
                    },
                  ]
                : ["password"]),
          },
        },
        error: null,
      }),
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

  it("accepts OTP recovery only with a signed proof of redemption for this session", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "isolated-test-signing-key");
    const accessToken = `header.${Buffer.from(JSON.stringify({ sub: "user-1", session_id: "session-1" })).toString("base64url")}.signature`;
    const proof = createRecoveryProof("user-1", accessToken)!;
    mockCreateClient.mockResolvedValue(
      createSupabaseAuthClient({
        amr: [{ method: "otp", timestamp: Math.floor(Date.now() / 1000) }],
      })
    );
    const denied = await GET(createGetRequest({ vm_password_recovery: "user-1" }));
    expect(await denied.json()).toEqual({ valid: false });
    const allowed = await GET(createGetRequest({ vm_password_recovery: proof }));
    expect(await allowed.json()).toEqual({ valid: true });
    vi.unstubAllEnvs();
  });

  it("returns valid:false when session user is missing", async () => {
    mockCreateClient.mockResolvedValue(createSupabaseAuthClient({ user: null }));

    const response = await GET(createGetRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ valid: false });
  });

  it("returns valid:false when recovery timestamp is stale", async () => {
    const stale = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    mockCreateClient.mockResolvedValue(
      createSupabaseAuthClient({ user: { id: "user-1", recovery_sent_at: stale } })
    );

    const response = await GET(createGetRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ valid: false });
  });

  it("returns valid:true when recovery session is recent", async () => {
    const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    mockCreateClient.mockResolvedValue(
      createSupabaseAuthClient({ user: { id: "user-1", recovery_sent_at: recent } })
    );

    const response = await GET(createGetRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ valid: true });
  });

  it("rejects a callback cookie without signed recovery proof", async () => {
    mockCreateClient.mockResolvedValue(
      createSupabaseAuthClient({ user: { id: "user-1", recovery_sent_at: null } })
    );

    const response = await GET(createGetRequest({ vm_password_recovery: "user-1" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ valid: false });
  });

  it("returns 500 when session check throws", async () => {
    mockCreateClient.mockRejectedValue(new Error("boom"));

    const response = await GET(createGetRequest());

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
    mockIsPwnedPassword.mockResolvedValue(false);
    mockSendPasswordChangeNotification.mockResolvedValue({ success: true });
  });

  it("completes a token-hash recovery with OTP AMR and signed session proof", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "isolated-test-signing-key");
    const accessToken = `header.${Buffer.from(JSON.stringify({ sub: "user-1", session_id: "session-1" })).toString("base64url")}.signature`;
    const proof = createRecoveryProof("user-1", accessToken)!;
    const client = createSupabaseAuthClient({
      amr: [{ method: "otp", timestamp: Math.floor(Date.now() / 1000) }],
    });
    mockCreateClient.mockResolvedValue(client);
    const response = await POST(
      createRequest(
        { password: "NewPassword123!", confirmPassword: "NewPassword123!" },
        { vm_password_recovery: proof }
      )
    );
    expect(response.status).toBe(200);
    expect(client.auth.updateUser).toHaveBeenCalledWith({ password: "NewPassword123!" });
    expect(client.auth.signOut).toHaveBeenCalled();
    expect(response.cookies.get("vm_password_recovery")?.value).toBe("");
    vi.unstubAllEnvs();
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

  it("returns 401 when authenticated user has no recovery proof", async () => {
    mockCreateClient.mockResolvedValue(
      createSupabaseAuthClient({ user: { id: "user-1", recovery_sent_at: null } })
    );

    const response = await POST(
      createRequest({ password: "NewPassword123!", confirmPassword: "NewPassword123!" })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Your reset link has expired or is invalid. Please request a new one.",
    });
  });

  it("updates password with signed recovery proof even without an email timestamp", async () => {
    const client = createSupabaseAuthClient({
      user: { id: "user-1", email: "user@example.com", recovery_sent_at: null },
      amr: ["password", { method: "recovery", timestamp: Math.floor(Date.now() / 1000) }],
    });
    mockCreateClient.mockResolvedValue(client);

    const response = await POST(
      createRequest(
        { password: "NewPassword123!", confirmPassword: "NewPassword123!" },
        { vm_password_recovery: "user-1" }
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(client.auth.updateUser).toHaveBeenCalledWith({ password: "NewPassword123!" });
    expect(response.headers.get("set-cookie")).toContain("vm_password_recovery=");
    await waitFor(() =>
      expect(mockSendPasswordChangeNotification).toHaveBeenCalledWith("user@example.com")
    );
  });

  it("rejects known-breached passwords before updating the user", async () => {
    mockIsPwnedPassword.mockResolvedValueOnce(true);
    const client = createSupabaseAuthClient();
    mockCreateClient.mockResolvedValue(client);

    const response = await POST(
      createRequest({ password: "NewPassword123!", confirmPassword: "NewPassword123!" })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "This password has appeared in a known data breach. Choose a different password.",
    });
    expect(client.auth.updateUser).not.toHaveBeenCalled();
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
    await waitFor(() =>
      expect(mockSendPasswordChangeNotification).toHaveBeenCalledWith("user@example.com")
    );
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
