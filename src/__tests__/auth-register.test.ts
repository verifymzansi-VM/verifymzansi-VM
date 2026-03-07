import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateClient, mockVerifyTurnstile } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockVerifyTurnstile: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/utils/turnstile", () => ({ verifyTurnstileToken: mockVerifyTurnstile }));
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

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
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
    const mockSignUp = vi.fn().mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mockCreateClient.mockResolvedValue({ auth: { signUp: mockSignUp } });

    const res = await POST(createRequest(validBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockSignUp).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "StrongP@ss1",
      options: {
        emailRedirectTo: "http://localhost:3000/auth/callback?next=/login?confirmed=true",
        data: {
          display_name: "Test User",
          phone: "+27821234567",
        },
      },
    });
  });

  it("validates Turnstile when configured", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "site-key";
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
    process.env.TURNSTILE_SECRET_KEY = "secret";
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "site-key";
    mockVerifyTurnstile.mockResolvedValue({ success: false, error: "Bot detected" });

    const res = await POST(createRequest(validBody));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Bot detected");
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
});
