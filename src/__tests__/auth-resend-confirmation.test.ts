import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import type * as TurnstileModule from "@/lib/utils/turnstile";

const { mockCreateClient, mockVerifyTurnstile, mockCheckRateLimit, mockGetClientIp } = vi.hoisted(
  () => ({
    mockCreateClient: vi.fn(),
    mockVerifyTurnstile: vi.fn(),
    mockCheckRateLimit: vi.fn(),
    mockGetClientIp: vi.fn(),
  })
);

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/utils/turnstile", async () => {
  const actual = await vi.importActual<typeof TurnstileModule>("@/lib/utils/turnstile");
  return {
    ...actual,
    verifyTurnstileToken: mockVerifyTurnstile,
  };
});
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/utils/api", () => ({
  parseAndValidateJsonRequest: vi.fn(
    async (
      req: { json: () => Promise<unknown> },
      schema: { safeParse: (value: unknown) => { success: boolean; data?: unknown } }
    ) => {
      try {
        const body = await req.json();
        const parsed = schema.safeParse(body);

        if (!parsed.success) {
          return {
            success: false,
            response: new Response(JSON.stringify({ error: "Invalid request" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }),
          };
        }

        return { success: true, data: parsed.data };
      } catch {
        return {
          success: false,
          response: new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }),
        };
      }
    }
  ),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: mockGetClientIp,
}));

import { POST } from "@/app/api/auth/resend-confirmation/route";

function createRequest(body: unknown): NextRequest {
  return {
    method: "POST",
    json: async () => body,
    url: "http://localhost:3000/api/auth/resend-confirmation",
    headers: new Headers(),
    nextUrl: new URL("http://localhost:3000/api/auth/resend-confirmation"),
  } as unknown as NextRequest;
}

function createCrossSiteRequest(body: unknown): NextRequest {
  return {
    method: "POST",
    json: async () => body,
    url: "https://verifymzansi.com/api/auth/resend-confirmation",
    headers: new Headers({ origin: "https://evil.example" }),
    nextUrl: new URL("https://verifymzansi.com/api/auth/resend-confirmation"),
  } as unknown as NextRequest;
}

describe("POST /api/auth/resend-confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockGetClientIp.mockReturnValue("127.0.0.1");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 400 for invalid JSON", async () => {
    const req = {
      method: "POST",
      json: async () => {
        throw new Error("bad json");
      },
      headers: new Headers(),
      url: "http://localhost:3000/api/auth/resend-confirmation",
      nextUrl: new URL("http://localhost:3000/api/auth/resend-confirmation"),
    } as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid");
  });

  it("returns 400 for missing email", async () => {
    const res = await POST(createRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 400 for invalid email format", async () => {
    const res = await POST(createRequest({ email: "not-an-email", turnstileToken: "tok" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 403 for cross-site resend confirmation requests", async () => {
    const res = await POST(
      createCrossSiteRequest({ email: "user@example.com", turnstileToken: "tok" })
    );

    expect(res.status).toBe(403);
  });

  it("returns success with valid email (anti-enumeration)", async () => {
    const mockResend = vi.fn().mockResolvedValue({ data: {}, error: null });
    mockCreateClient.mockResolvedValue({ auth: { resend: mockResend } });

    const res = await POST(createRequest({ email: "user@example.com", turnstileToken: "tok" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain("confirmation link");
    expect(mockResend).toHaveBeenCalledWith({
      type: "signup",
      email: "user@example.com",
      options: {
        emailRedirectTo: "https://verifymzansi.com/auth/callback?next=%2Flogin%3Fconfirmed%3Dtrue",
      },
    });
  });

  it("returns success even when resend fails (anti-enumeration)", async () => {
    const mockResend = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "User not found" },
    });
    mockCreateClient.mockResolvedValue({ auth: { resend: mockResend } });

    const res = await POST(
      createRequest({ email: "nonexistent@example.com", turnstileToken: "tok" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Should NOT reveal that the email doesn't exist
    expect(body.success).toBe(true);
    expect(body.message).toContain("confirmation link");
  });

  it("returns success when email is already confirmed (anti-enumeration)", async () => {
    const mockResend = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Email already confirmed" },
    });
    mockCreateClient.mockResolvedValue({ auth: { resend: mockResend } });

    const res = await POST(
      createRequest({ email: "confirmed@example.com", turnstileToken: "tok" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("returns 429 when confirmation emails are rate limited", async () => {
    const mockResend = vi.fn().mockResolvedValue({
      data: null,
      error: {
        message: "email rate limit exceeded",
        status: 429,
        code: "over_email_send_rate_limit",
      },
    });
    mockCreateClient.mockResolvedValue({ auth: { resend: mockResend } });

    const res = await POST(createRequest({ email: "user@example.com", turnstileToken: "tok" }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain("rate-limited");
  });

  it("validates Turnstile when configured", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
    mockVerifyTurnstile.mockResolvedValue({ success: false, error: "Bot detected" });

    const res = await POST(createRequest({ email: "user@example.com", turnstileToken: "bad" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Bot detected");
  });

  it("returns 503 in production when Turnstile is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

    const res = await POST(createRequest({ email: "user@example.com", turnstileToken: "tok" }));

    expect(res.status).toBe(503);
    expect(mockVerifyTurnstile).not.toHaveBeenCalled();
  });
});
