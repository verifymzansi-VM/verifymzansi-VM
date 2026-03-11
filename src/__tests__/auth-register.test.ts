import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import type * as TurnstileModule from "@/lib/utils/turnstile";

const { mockCreateClient, mockVerifyTurnstile } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockVerifyTurnstile: vi.fn(),
}));

const { mockCreateAdminClient, mockProfileUpsert, mockCheckRateLimit } = vi.hoisted(() => ({
  mockCreateAdminClient: vi.fn(),
  mockProfileUpsert: vi.fn().mockResolvedValue({ error: null }),
  mockCheckRateLimit: vi.fn().mockResolvedValue({ limited: false }),
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
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));
vi.mock("@/lib/utils/api", () => ({
  parseJsonRequest: vi.fn(async (req: { json: () => Promise<unknown> }) => {
    try {
      return await req.json();
    } catch {
      return null;
    }
  }),
}));

import { POST } from "@/app/api/auth/register/route";

function createRequest(body: unknown): NextRequest {
  return {
    method: "POST",
    json: async () => body,
    url: "http://localhost:3000/api/auth/register",
    headers: { get: vi.fn().mockReturnValue(null) },
    nextUrl: new URL("http://localhost:3000/api/auth/register"),
  } as unknown as NextRequest;
}

const validBody = {
  email: "user@example.com",
  password: "StrongP@ss1",
  confirmPassword: "StrongP@ss1",
  displayName: "Test User",
  phone: "+27821234567",
  acceptTerms: true,
  turnstileToken: "tok-valid",
};

function createAdminMock(existingPhoneProfile: { id: string } | null = null) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: existingPhoneProfile, error: null }),
      upsert: mockProfileUpsert,
    }),
  };
}

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockCreateAdminClient.mockReturnValue(createAdminMock() as never);
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
      headers: { get: vi.fn().mockReturnValue(null) },
      nextUrl: new URL("http://localhost:3000/api/auth/register"),
    } as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid");
  });

  it("returns 400 for missing required fields", async () => {
    const res = await POST(createRequest({}));
    expect(res.status).toBe(400);
  });

  it("succeeds with valid data (no Turnstile configured)", async () => {
    const mockSignUp = vi.fn().mockResolvedValue({
      data: { user: { id: "u1", identities: [{ id: "identity-1" }] } },
      error: null,
    });
    mockCreateClient.mockResolvedValue({ auth: { signUp: mockSignUp } });

    const res = await POST(createRequest(validBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockSignUp).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "StrongP@ss1",
      options: {
        emailRedirectTo: "https://verifymzansi.com/auth/callback?next=%2F%3Fconfirmed%3Dtrue",
        data: {
          display_name: "Test User",
          phone: "+27821234567",
        },
      },
    });
    expect(mockProfileUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "u1",
        display_name: "Test User",
        phone: "+27821234567",
        masked_phone_public: "+27 •••• ••67",
        account_verification_status: "incomplete",
        seller_verification_status: "incomplete",
        account_status: "active",
      }),
      { onConflict: "user_id" }
    );
  });

  it("normalizes local SA phone numbers before persisting profile data", async () => {
    const mockSignUp = vi.fn().mockResolvedValue({
      data: { user: { id: "u1", identities: [{ id: "identity-1" }] } },
      error: null,
    });
    mockCreateClient.mockResolvedValue({ auth: { signUp: mockSignUp } });

    const res = await POST(
      createRequest({
        ...validBody,
        phone: "0821234567",
      })
    );

    expect(res.status).toBe(200);
    expect(mockSignUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          data: expect.objectContaining({ phone: "+27821234567" }),
        }),
      })
    );
    expect(mockProfileUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+27821234567",
        masked_phone_public: "+27 •••• ••67",
      }),
      { onConflict: "user_id" }
    );
  });

  it("validates Turnstile when configured", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
    mockVerifyTurnstile.mockResolvedValue({ success: true });
    const mockSignUp = vi.fn().mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mockCreateClient.mockResolvedValue({ auth: { signUp: mockSignUp } });

    const res = await POST(createRequest(validBody));
    expect(res.status).toBe(200);
    expect(mockVerifyTurnstile).toHaveBeenCalledWith(
      expect.objectContaining({ token: "tok-valid" })
    );
  });

  it("rejects failed Turnstile verification", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
    mockVerifyTurnstile.mockResolvedValue({ success: false, error: "Bot detected" });

    const res = await POST(createRequest(validBody));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Bot detected");
  });

  it("fails closed in production when the Turnstile site key is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

    const res = await POST(createRequest(validBody));

    expect(res.status).toBe(503);
    expect(mockVerifyTurnstile).not.toHaveBeenCalled();
  });

  it("returns generic error on auth failure (anti-enumeration)", async () => {
    const mockSignUp = vi.fn().mockResolvedValue({
      data: { user: null },
      error: { message: "User already registered" },
    });
    mockCreateClient.mockResolvedValue({ auth: { signUp: mockSignUp } });

    const res = await POST(createRequest(validBody));
    expect(res.status).toBe(400);
    const body = await res.json();
    // Should NOT reveal "User already registered"
    expect(body.error).not.toContain("already registered");
    expect(body.error).toContain("Registration failed");
  });

  it("returns 429 when signup email sending is rate limited", async () => {
    const mockSignUp = vi.fn().mockResolvedValue({
      data: { user: null },
      error: {
        message: "email rate limit exceeded",
        status: 429,
        code: "over_email_send_rate_limit",
      },
    });
    mockCreateClient.mockResolvedValue({ auth: { signUp: mockSignUp } });

    const res = await POST(createRequest(validBody));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain("rate-limited");
  });

  it("returns 409 when the phone number is already linked to another account", async () => {
    mockCreateAdminClient.mockReturnValue(createAdminMock({ id: "sp-1" }) as never);

    const res = await POST(createRequest(validBody));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: "This phone number is already linked to another account.",
    });
  });
});
