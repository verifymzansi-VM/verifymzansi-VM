import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import type * as ApiModule from "@/lib/utils/api";
import type * as TurnstileModule from "@/lib/utils/turnstile";

const { mockCreateClient, mockVerifyTurnstile, mockCheckRateLimit } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockVerifyTurnstile: vi.fn(),
  mockCheckRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/utils/turnstile", async () => {
  const actual = await vi.importActual<typeof TurnstileModule>("@/lib/utils/turnstile");
  return {
    ...actual,
    verifyTurnstileToken: mockVerifyTurnstile,
  };
});
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
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
  mockCreateClient.mockResolvedValue({
    auth: {
      signInWithPassword: mockSignIn,
    },
  });
  mockSignIn.mockResolvedValue(result);
  return { mockSignIn };
}

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    mockCheckRateLimit.mockResolvedValue({ limited: false });
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

  it("returns a confirmation-specific error when credentials are correct but email is unconfirmed", async () => {
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

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({
      error: "Please confirm your email address before signing in.",
      code: "email_not_confirmed",
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
});
