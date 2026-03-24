import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateClient, mockCheckRateLimit } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCheckRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));
vi.mock("@/lib/utils/csrf", () => ({
  enforceCsrfToken: vi.fn(() => null),
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

  it("returns 401 when the current password is incorrect", async () => {
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

    expect(res.status).toBe(200);
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "old-password-123",
    });
    expect(updateUser).toHaveBeenCalledWith({ password: "NewPassword123" });
  });
});
