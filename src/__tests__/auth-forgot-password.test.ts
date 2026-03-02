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

import { POST } from "@/app/api/auth/forgot-password/route";

function createRequest(body: unknown): NextRequest {
  return {
    method: "POST",
    json: async () => body,
    url: "http://localhost:3000/api/auth/forgot-password",
    headers: { get: vi.fn().mockReturnValue(null) },
    nextUrl: new URL("http://localhost:3000/api/auth/forgot-password"),
  } as unknown as NextRequest;
}

describe("POST /api/auth/forgot-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TURNSTILE_SECRET_KEY;
  });

  it("returns 400 for invalid JSON", async () => {
    const req = {
      method: "POST",
      json: async () => {
        throw new Error("bad");
      },
      url: "http://localhost:3000/api/auth/forgot-password",
      headers: { get: vi.fn().mockReturnValue(null) },
      nextUrl: new URL("http://localhost:3000/api/auth/forgot-password"),
    } as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing email", async () => {
    const res = await POST(createRequest({}));
    expect(res.status).toBe(400);
  });

  it("always returns success for anti-enumeration", async () => {
    const mockReset = vi.fn().mockResolvedValue({ data: {}, error: null });
    mockCreateClient.mockResolvedValue({ auth: { resetPasswordForEmail: mockReset } });

    const res = await POST(createRequest({ email: "exists@example.com", turnstileToken: "tok" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("returns success even for non-existent email (anti-enumeration)", async () => {
    const mockReset = vi.fn().mockResolvedValue({ data: {}, error: null });
    mockCreateClient.mockResolvedValue({ auth: { resetPasswordForEmail: mockReset } });

    const res = await POST(createRequest({ email: "noone@example.com", turnstileToken: "tok" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("validates Turnstile when configured", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    mockVerifyTurnstile.mockResolvedValue({ success: false, error: "Failed" });

    const res = await POST(createRequest({ email: "test@example.com", turnstileToken: "bad-tok" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Failed");
  });
});
