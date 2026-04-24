import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateClient, mockCreateAdminClient, mockCheckRateLimit } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockCheckRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

import { POST } from "./route";

const CSRF_TOKEN = "a".repeat(64);

function createRequest(body: unknown, headers: Record<string, string> = {}) {
  const mergedHeaders: Record<string, string> = {
    origin: "http://localhost:3000",
    cookie: `vm_csrf=${CSRF_TOKEN}`,
    "x-csrf-token": CSRF_TOKEN,
    ...Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
    ),
  };

  return {
    method: "POST",
    json: async () => body,
    url: "http://localhost:3000/api/account/delete",
    nextUrl: new URL("http://localhost:3000/api/account/delete"),
    headers: {
      get(name: string) {
        return mergedHeaders[name.toLowerCase()] ?? null;
      },
    },
  } as unknown as NextRequest;
}

function createMutationBuilder(error: { code?: string; message?: string } | null = null) {
  return {
    eq: vi.fn().mockResolvedValue({ error }),
  };
}

function createAdminClientMock(
  options: {
    legalHold?: boolean;
    cleanupError?: { code?: string; message?: string } | null;
    deleteUserError?: { message: string } | null;
  } = {}
) {
  const deleteUser = vi.fn().mockResolvedValue({ error: options.deleteUserError ?? null });
  const cleanupError = options.cleanupError ?? null;
  const firstCleanupUpdate = vi.fn().mockReturnValue(createMutationBuilder(cleanupError));
  let cleanupUpdateUsed = false;

  const from = vi.fn((table: string) => {
    if (table === "account_profiles") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { legal_hold: options.legalHold ?? false },
              error: null,
            }),
          }),
        }),
      };
    }

    return {
      delete: vi.fn().mockReturnValue(createMutationBuilder()),
      update: cleanupUpdateUsed
        ? vi.fn().mockReturnValue(createMutationBuilder())
        : firstCleanupUpdate.mockImplementation((_payload: unknown) => {
            cleanupUpdateUsed = true;
            return createMutationBuilder(cleanupError);
          }),
    };
  });

  const admin = {
    from,
    auth: {
      admin: { deleteUser },
    },
  };
  mockCreateAdminClient.mockReturnValue(admin);
  return { admin, deleteUser, firstCleanupUpdate };
}

function createSupabaseClientMock(user: unknown, options: { passwordError?: boolean } = {}) {
  const signInWithPassword = vi
    .fn()
    .mockResolvedValue({ error: options.passwordError ? { message: "bad password" } : null });
  const signOut = vi.fn().mockResolvedValue({ error: null });
  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
      signInWithPassword,
      signOut,
    },
  });
  return { signInWithPassword, signOut };
}

describe("POST /api/account/delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    createAdminClientMock();
  });

  it("rejects unauthenticated requests", async () => {
    createSupabaseClientMock(null);

    const res = await POST(createRequest({ confirmation: "DELETE" }));

    expect(res.status).toBe(401);
  });

  it("rejects cross-site requests before auth or cleanup", async () => {
    const res = await POST(
      createRequest({ confirmation: "DELETE" }, { origin: "https://evil.example" })
    );

    expect(res.status).toBe(403);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("rejects requests without a CSRF token", async () => {
    const res = await POST(
      createRequest(
        { confirmation: "DELETE" },
        {
          cookie: "",
          "x-csrf-token": "",
        }
      )
    );

    expect(res.status).toBe(403);
  });

  it("requires DELETE confirmation", async () => {
    createSupabaseClientMock({
      id: "user-1",
      email: "user@example.com",
      identities: [{ provider: "google" }],
      app_metadata: { provider: "google" },
    });

    const res = await POST(createRequest({ confirmation: "nope" }));

    expect(res.status).toBe(400);
  });

  it("returns 429 when rate limited", async () => {
    mockCheckRateLimit.mockResolvedValueOnce({ limited: true, degraded: false, retryAfter: 30 });

    const res = await POST(createRequest({ confirmation: "DELETE" }));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
  });

  it("requires current password for password accounts", async () => {
    createSupabaseClientMock({
      id: "user-1",
      email: "user@example.com",
      identities: [{ provider: "email" }],
      app_metadata: { provider: "email" },
    });

    const res = await POST(createRequest({ confirmation: "DELETE" }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "PASSWORD_REQUIRED" });
  });

  it("rejects an incorrect password for password accounts", async () => {
    const { signInWithPassword } = createSupabaseClientMock(
      {
        id: "user-1",
        email: "user@example.com",
        identities: [{ provider: "email" }],
        app_metadata: { provider: "email" },
      },
      { passwordError: true }
    );

    const res = await POST(
      createRequest({ confirmation: "DELETE", currentPassword: "wrong-password" })
    );

    expect(res.status).toBe(401);
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "wrong-password",
    });
  });

  it("allows Google-only authenticated deletion without a password", async () => {
    const { signInWithPassword, signOut } = createSupabaseClientMock({
      id: "user-1",
      email: "user@gmail.com",
      identities: [{ provider: "google" }],
      app_metadata: { provider: "google" },
    });
    const { deleteUser } = createAdminClientMock();

    const res = await POST(createRequest({ confirmation: "DELETE" }));

    expect(res.status).toBe(200);
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledWith("user-1");
    expect(signOut).toHaveBeenCalled();
  });

  it("blocks legal-hold accounts", async () => {
    createSupabaseClientMock({
      id: "user-1",
      email: "user@gmail.com",
      identities: [{ provider: "google" }],
      app_metadata: { provider: "google" },
    });
    const { deleteUser } = createAdminClientMock({ legalHold: true });

    const res = await POST(createRequest({ confirmation: "DELETE" }));

    expect(res.status).toBe(409);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("returns 500 if cleanup fails and does not delete auth user", async () => {
    createSupabaseClientMock({
      id: "user-1",
      email: "user@gmail.com",
      identities: [{ provider: "google" }],
      app_metadata: { provider: "google" },
    });
    const { deleteUser } = createAdminClientMock({
      cleanupError: { code: "500", message: "cleanup failed" },
    });

    const res = await POST(createRequest({ confirmation: "DELETE" }));

    expect(res.status).toBe(500);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("returns 500 if Supabase auth deletion fails", async () => {
    createSupabaseClientMock({
      id: "user-1",
      email: "user@gmail.com",
      identities: [{ provider: "google" }],
      app_metadata: { provider: "google" },
    });
    createAdminClientMock({ deleteUserError: { message: "delete failed" } });

    const res = await POST(createRequest({ confirmation: "DELETE" }));

    expect(res.status).toBe(500);
  });
});
