import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const {
  mockCreateClient,
  mockCreatePublicClient,
  mockCheckRateLimit,
  mockIsPwnedPassword,
  mockNotify,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreatePublicClient: vi.fn(),
  mockCheckRateLimit: vi.fn().mockResolvedValue({ limited: false }),
  mockIsPwnedPassword: vi.fn().mockResolvedValue(false),
  mockNotify: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/services/email", () => ({ sendPasswordChangeNotification: mockNotify }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
  createPublicClient: mockCreatePublicClient,
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));
vi.mock("@/lib/utils/csrf", () => ({
  enforceCsrfToken: vi.fn(() => null),
}));
vi.mock("@/lib/security/pwned-passwords", () => ({
  checkPasswordBreach: async (password: string) =>
    (await mockIsPwnedPassword(password)) ? "breached" : "clear",
  PWNED_PASSWORD_ERROR:
    "This password has appeared in a known data breach. Choose a different password.",
}));

import { POST } from "@/app/api/auth/change-password/route";

function createRequest(body: unknown, headers: Record<string, string> = {}) {
  return {
    method: "POST",
    json: async () => body,
    url: "http://localhost:3000/api/auth/change-password",
    nextUrl: new URL("http://localhost:3000/api/auth/change-password"),
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? headers[name] ?? null;
      },
    },
  } as unknown as NextRequest;
}

describe("POST /api/auth/change-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockIsPwnedPassword.mockResolvedValue(false);
    mockNotify.mockResolvedValue(true);
    mockCreatePublicClient.mockReturnValue({
      auth: {
        signInWithPassword: vi
          .fn()
          .mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
    });
  });

  it("rejects cross-site requests", async () => {
    const res = await POST(
      createRequest(
        {
          currentPassword: "old-pass-123",
          newPassword: "NewPassword123",
          confirmNewPassword: "NewPassword123",
        },
        { origin: "https://evil.example" }
      )
    );

    expect(res.status).toBe(403);
  });

  it("requires authentication", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    });

    const res = await POST(
      createRequest({
        currentPassword: "a",
        newPassword: "NewPassword123",
        confirmNewPassword: "NewPassword123",
      })
    );

    expect(res.status).toBe(401);
  });

  it("returns 503 when shared protection is degraded", async () => {
    mockCheckRateLimit.mockResolvedValue({
      limited: true,
      degraded: true,
      retryAfter: 45,
    });

    const res = await POST(
      createRequest({
        currentPassword: "old-pass-123",
        newPassword: "NewPassword123",
        confirmNewPassword: "NewPassword123",
      })
    );

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("45");
    await expect(res.json()).resolves.toEqual({
      error: "Password change protection is temporarily unavailable. Please try again shortly.",
    });
  });

  it("returns 429 when rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue({
      limited: true,
      degraded: false,
      retryAfter: 30,
    });

    const res = await POST(
      createRequest({
        currentPassword: "old-pass-123",
        newPassword: "NewPassword123",
        confirmNewPassword: "NewPassword123",
      })
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    await expect(res.json()).resolves.toEqual({
      error: "Too many attempts. Please try again later.",
    });
  });

  it("returns 401 when the current password is incorrect", async () => {
    mockCreatePublicClient.mockReturnValue({
      auth: {
        signInWithPassword: vi
          .fn()
          .mockResolvedValue({ data: { user: null }, error: { message: "bad password" } }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
    });
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "user@example.com" } },
          error: null,
        }),
        signInWithPassword: vi.fn().mockResolvedValue({ error: { message: "bad password" } }),
        updateUser: vi.fn(),
      },
    });

    const res = await POST(
      createRequest({
        currentPassword: "wrong-password",
        newPassword: "NewPassword123",
        confirmNewPassword: "NewPassword123",
      })
    );

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Current password is incorrect" });
  });

  it("updates the password on valid input", async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ error: null });
    const updateUser = vi.fn().mockResolvedValue({ error: null });
    const signOut = vi.fn().mockResolvedValue({ error: null });

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "user@example.com" } },
          error: null,
        }),
        signInWithPassword,
        updateUser,
        signOut,
      },
    });

    const res = await POST(
      createRequest({
        currentPassword: "old-password-123",
        newPassword: "NewPassword123",
        confirmNewPassword: "NewPassword123",
      })
    );

    expect(res.status).toBe(200);
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(mockCreatePublicClient().auth.signInWithPassword).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "old-password-123",
    });
    expect(updateUser).toHaveBeenCalledWith({
      password: "NewPassword123",
      current_password: "old-password-123",
    });
    expect(mockCreatePublicClient().auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(signOut).toHaveBeenCalledWith({ scope: "others" });
    expect(mockNotify).toHaveBeenCalledWith("user@example.com");
  });

  it.each([
    ["insufficient_aal", 403, "mfa_required"],
    ["reauthentication_needed", 409, "reauthentication_required"],
    ["current_password_mismatch", 401, undefined],
    ["current_password_invalid", 401, undefined],
  ])(
    "handles %s without replacing or revoking the caller session",
    async (code, status, responseCode) => {
      const signInWithPassword = vi.fn();
      const signOut = vi.fn();
      mockCreateClient.mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: "user-1", email: "user@example.com" } },
            error: null,
          }),
          signInWithPassword,
          signOut,
          updateUser: vi.fn().mockResolvedValue({ error: { code, message: "provider refusal" } }),
        },
      });
      const res = await POST(
        createRequest({
          currentPassword: "old-password-123",
          newPassword: "NewPassword123",
          confirmNewPassword: "NewPassword123",
        })
      );
      expect(res.status).toBe(status);
      expect((await res.json()).code).toBe(responseCode);
      expect(signInWithPassword).not.toHaveBeenCalled();
      expect(signOut).not.toHaveBeenCalled();
      expect(mockNotify).not.toHaveBeenCalled();
    }
  );

  it("refuses a different identity returned by password verification", async () => {
    mockCreatePublicClient().auth.signInWithPassword.mockResolvedValue({
      data: { user: { id: "other-user" } },
      error: null,
    });
    const updateUser = vi.fn();
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "user@example.com" } },
          error: null,
        }),
        updateUser,
      },
    });
    const res = await POST(
      createRequest({
        currentPassword: "old-password-123",
        newPassword: "NewPassword123",
        confirmNewPassword: "NewPassword123",
      })
    );
    expect(res.status).toBe(401);
    expect(updateUser).not.toHaveBeenCalled();
    expect(mockCreatePublicClient().auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("rejects known-breached new passwords before updating the user", async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ error: null });
    const updateUser = vi.fn();
    mockIsPwnedPassword.mockResolvedValueOnce(true);

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "user@example.com" } },
          error: null,
        }),
        signInWithPassword,
        updateUser,
      },
    });

    const res = await POST(
      createRequest({
        currentPassword: "old-password-123",
        newPassword: "NewPassword123",
        confirmNewPassword: "NewPassword123",
      })
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "This password has appeared in a known data breach. Choose a different password.",
    });
    expect(updateUser).not.toHaveBeenCalled();
  });
});
