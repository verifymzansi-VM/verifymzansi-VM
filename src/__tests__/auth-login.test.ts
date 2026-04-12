import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import type * as ApiModule from "@/lib/utils/api";
import type * as TurnstileModule from "@/lib/utils/turnstile";

const {
  mockCreateClient,
  mockVerifyTurnstile,
  mockCheckRateLimit,
  mockGetClientRateLimitIdentity,
  mockCreateAdminClient,
  mockCheckAccountLockout,
  mockCheckDistributedLockout,
  mockRecordFailedLogin,
  mockRecordDistributedFailedLogin,
  mockEnforceSameOriginMutation,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockVerifyTurnstile: vi.fn(),
  mockCheckRateLimit: vi.fn().mockResolvedValue({ limited: false }),
  mockGetClientRateLimitIdentity: vi.fn().mockReturnValue({
    key: "127.0.0.1",
    source: "x-forwarded-for",
    ip: "127.0.0.1",
  }),
  mockCreateAdminClient: vi.fn(),
  mockCheckAccountLockout: vi.fn().mockReturnValue({ locked: false }),
  mockCheckDistributedLockout: vi.fn().mockResolvedValue({ locked: false }),
  mockRecordFailedLogin: vi.fn(),
  mockRecordDistributedFailedLogin: vi.fn().mockResolvedValue(undefined),
  mockEnforceSameOriginMutation: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/utils/turnstile", async () => {
  const actual = await vi.importActual<typeof TurnstileModule>("@/lib/utils/turnstile");
  return {
    ...actual,
    verifyTurnstileToken: mockVerifyTurnstile,
  };
});
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientRateLimitIdentity: mockGetClientRateLimitIdentity,
}));
vi.mock("@/lib/utils/account-lockout", () => ({
  checkAccountLockout: mockCheckAccountLockout,
  recordFailedLogin: mockRecordFailedLogin,
  clearLockout: vi.fn(),
  checkDistributedLockout: mockCheckDistributedLockout,
  recordDistributedFailedLogin: mockRecordDistributedFailedLogin,
}));
vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: mockEnforceSameOriginMutation,
}));
vi.mock("@/lib/utils/api", async () => {
  const actual = await vi.importActual<typeof ApiModule>("@/lib/utils/api");
  return {
    ...actual,
    parseJsonRequest: vi.fn(async (req: { json: () => Promise<unknown> }) => {
      try {
        return await req.json();
      } catch {
        return null;
      }
    }),
    parseAndValidateJsonRequest: vi.fn(async (req: { json: () => Promise<unknown> }, schema) => {
      try {
        const body = await req.json();
        const parsed = schema.safeParse(body);
        if (!parsed.success) {
          return {
            success: false,
            response: Response.json(
              { error: parsed.error.issues[0]?.message ?? "Invalid request" },
              { status: 400 }
            ),
          };
        }
        return { success: true, data: parsed.data };
      } catch {
        return {
          success: false,
          response: Response.json({ error: "Invalid JSON payload" }, { status: 400 }),
        };
      }
    }),
  };
});

import { POST } from "@/app/api/auth/login/route";

function createRequest(body: unknown, method = "POST") {
  return {
    method,
    json: async () => body,
    url: "https://verifymzansi.com/api/auth/login",
    headers: { get: vi.fn().mockReturnValue(null) },
    nextUrl: new URL("https://verifymzansi.com/api/auth/login"),
  } as unknown as NextRequest;
}

function mockAuth(result: {
  data: { user: { id: string; email?: string } | null; session?: { access_token: string } | null };
  error: { message: string; status?: number } | null;
}) {
  const mockSignIn = vi.fn();
  const mockGetUser = vi.fn().mockResolvedValue({
    data: { user: result.data.user },
  });
  mockCreateClient.mockResolvedValue({
    auth: {
      signInWithPassword: mockSignIn,
      getUser: mockGetUser,
    },
  });
  mockSignIn.mockResolvedValue(result);
  // Mock admin client for account_status check
  mockCreateAdminClient.mockReturnValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { account_status: "active" },
          }),
        }),
      }),
    }),
  });
  return { mockSignIn };
}

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockGetClientRateLimitIdentity.mockReturnValue({
      key: "127.0.0.1",
      source: "x-forwarded-for",
      ip: "127.0.0.1",
    });
    mockCheckAccountLockout.mockReturnValue({ locked: false });
    mockCheckDistributedLockout.mockResolvedValue({ locked: false });
    mockEnforceSameOriginMutation.mockReturnValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects empty body", async () => {
    const res = await POST(createRequest({}));
    expect(res.status).toBe(400);
  });

  it("handles invalid credentials", async () => {
    mockAuth({
      data: { user: null, session: null },
      error: { message: "Invalid login credentials", status: 400 },
    });

    const res = await POST(
      createRequest({
        email: "bad@test.com",
        password: "wrong",
        turnstileToken: "tok",
      })
    );

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Invalid email or password" });
  });

  it("succeeds with valid credentials", async () => {
    const { mockSignIn } = mockAuth({
      data: {
        user: { id: "user-1", email: "test@example.com" },
        session: { access_token: "tok" },
      },
      error: null,
    });

    const res = await POST(
      createRequest({
        email: "test@example.com",
        password: "validPass123",
        turnstileToken: "tok",
      })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(mockSignIn).toHaveBeenCalledWith({
      email: "test@example.com",
      password: "validPass123",
    });
  });

  it("returns generic 401 when credentials are correct but email is unconfirmed (anti-enumeration)", async () => {
    mockAuth({
      data: { user: null, session: null },
      error: { message: "Email not confirmed", status: 400 },
    });

    const res = await POST(
      createRequest({
        email: "unconfirmed@test.com",
        password: "validPass123",
        turnstileToken: "tok",
      })
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({
      error: "Invalid email or password",
    });
  });

  it("validates Turnstile when configured", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "site-key";
    mockVerifyTurnstile.mockResolvedValue({ success: true });
    mockAuth({
      data: { user: { id: "user-1" }, session: { access_token: "tok" } },
      error: null,
    });

    const res = await POST(
      createRequest({
        email: "test@example.com",
        password: "validPass123",
        turnstileToken: "tok-valid",
      })
    );

    expect(res.status).toBe(200);
    expect(mockVerifyTurnstile).toHaveBeenCalledWith(
      expect.objectContaining({ token: "tok-valid" })
    );
  });

  it("returns 503 with Retry-After when Turnstile verification is temporarily unavailable", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "site-key";
    mockVerifyTurnstile.mockResolvedValue({
      success: false,
      temporary: true,
      error: "Security verification timed out. Please retry.",
    });

    const res = await POST(
      createRequest({
        email: "test@example.com",
        password: "validPass123",
        turnstileToken: "tok-valid",
      })
    );

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
    await expect(res.json()).resolves.toEqual({
      error: "Security verification timed out. Please retry.",
    });
  });

  it("fails closed in production when Turnstile is partially configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

    const res = await POST(
      createRequest({
        email: "test@example.com",
        password: "validPass123",
        turnstileToken: "tok-valid",
      })
    );

    expect(res.status).toBe(503);
    expect(mockVerifyTurnstile).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue({ limited: true, retryAfter: 30 });

    const res = await POST(
      createRequest({
        email: "test@example.com",
        password: "validPass123",
        turnstileToken: "tok",
      })
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
  });

  it("returns 429 when account is locked out", async () => {
    mockCheckAccountLockout.mockReturnValue({ locked: true, retryAfter: 3600 });

    const res = await POST(
      createRequest({
        email: "locked@example.com",
        password: "validPass123",
        turnstileToken: "tok",
      })
    );

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatch(/Account temporarily locked/);
  });

  it("returns 429 when distributed lockout is active", async () => {
    mockCheckDistributedLockout.mockResolvedValue({ locked: true, retryAfter: 1800 });

    const res = await POST(
      createRequest({
        email: "dist-locked@example.com",
        password: "validPass123",
        turnstileToken: "tok",
      })
    );

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatch(/Account temporarily locked/);
  });

  it("records failed login on invalid credentials", async () => {
    mockAuth({
      data: { user: null, session: null },
      error: { message: "Invalid login credentials", status: 400 },
    });

    await POST(
      createRequest({
        email: "bad@test.com",
        password: "wrong",
        turnstileToken: "tok",
      })
    );

    expect(mockRecordFailedLogin).toHaveBeenCalledWith("bad@test.com");
    expect(mockRecordDistributedFailedLogin).toHaveBeenCalledWith("bad@test.com");
  });

  it("blocks suspended accounts at pre-session check with generic 401", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { account_status: "suspended", user_id: "user-susp" },
            }),
          }),
        }),
      }),
    });
    mockCreateClient.mockResolvedValue({
      auth: {
        signInWithPassword: vi.fn(),
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });

    const res = await POST(
      createRequest({
        email: "suspended@test.com",
        password: "validPass123",
        turnstileToken: "tok",
      })
    );

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Invalid email or password" });
  });

  it("blocks cross-origin mutation requests", async () => {
    mockEnforceSameOriginMutation.mockReturnValue(
      new Response(JSON.stringify({ error: "Cross-origin request blocked" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );

    const res = await POST(
      createRequest({
        email: "test@example.com",
        password: "validPass123",
        turnstileToken: "tok",
      })
    );

    expect(res.status).toBe(403);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("returns 503 with Retry-After on degraded rate limiter", async () => {
    mockCheckRateLimit.mockResolvedValue({ limited: true, degraded: true, retryAfter: 60 });

    const res = await POST(
      createRequest({
        email: "test@example.com",
        password: "validPass123",
        turnstileToken: "tok",
      })
    );

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
    const body = await res.json();
    expect(body.error).toMatch(/temporarily unavailable/);
  });
});
