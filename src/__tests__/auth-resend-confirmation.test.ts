import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
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

import { POST } from "@/app/api/auth/resend-confirmation/route";

function createRequest(body: unknown): NextRequest {
  return {
    method: "POST",
    json: async () => body,
    url: "http://localhost:3000/api/auth/resend-confirmation",
    headers: { get: vi.fn().mockReturnValue(null) },
    nextUrl: new URL("http://localhost:3000/api/auth/resend-confirmation"),
  } as unknown as NextRequest;
}

describe("POST /api/auth/resend-confirmation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 for invalid JSON", async () => {
    const req = {
      method: "POST",
      json: async () => {
        throw new Error("bad json");
      },
      headers: { get: vi.fn().mockReturnValue(null) },
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
    const res = await POST(createRequest({ email: "not-an-email" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns success with valid email (anti-enumeration)", async () => {
    const mockResend = vi.fn().mockResolvedValue({ data: {}, error: null });
    mockCreateClient.mockResolvedValue({ auth: { resend: mockResend } });

    const res = await POST(createRequest({ email: "user@example.com" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain("confirmation link");
    expect(mockResend).toHaveBeenCalledWith({
      type: "signup",
      email: "user@example.com",
      options: {
        emailRedirectTo: "http://localhost:3000/auth/callback?next=/login?confirmed=true",
      },
    });
  });

  it("returns success even when resend fails (anti-enumeration)", async () => {
    const mockResend = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "User not found" },
    });
    mockCreateClient.mockResolvedValue({ auth: { resend: mockResend } });

    const res = await POST(createRequest({ email: "nonexistent@example.com" }));
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

    const res = await POST(createRequest({ email: "confirmed@example.com" }));
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

    const res = await POST(createRequest({ email: "user@example.com" }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain("rate-limited");
  });
});
