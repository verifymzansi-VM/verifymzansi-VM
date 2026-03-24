import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import type * as TurnstileModule from "@/lib/utils/turnstile";
import type * as ApiModule from "@/lib/utils/api";

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
vi.mock("@/lib/utils/api", async () => {
  const actual = await vi.importActual<typeof ApiModule>("@/lib/utils/api");
  return {
    ...actual,
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
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: mockGetClientIp,
}));

import { POST } from "@/app/api/auth/forgot-password/route";

function createRequest(body: unknown): NextRequest {
  return {
    method: "POST",
    json: async () => body,
    url: "https://verifymzansi.com/api/auth/forgot-password",
    headers: { get: vi.fn().mockReturnValue(null) },
    nextUrl: new URL("https://verifymzansi.com/api/auth/forgot-password"),
  } as unknown as NextRequest;
}

describe("POST /api/auth/forgot-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockGetClientIp.mockReturnValue("127.0.0.1");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
    delete process.env.TURNSTILE_SECRET_KEY;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
    expect(mockReset).toHaveBeenCalledWith("exists@example.com", {
      redirectTo: "https://verifymzansi.com/auth/callback?next=%2Freset-password",
    });
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
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
    mockVerifyTurnstile.mockResolvedValue({ success: false, error: "Failed" });

    const res = await POST(createRequest({ email: "test@example.com", turnstileToken: "bad-tok" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Failed");
  });

  it("fails closed in production when Turnstile is partially configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

    const res = await POST(createRequest({ email: "test@example.com", turnstileToken: "tok" }));

    expect(res.status).toBe(503);
    expect(mockVerifyTurnstile).not.toHaveBeenCalled();
  });
});
