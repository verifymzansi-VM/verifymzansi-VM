import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type * as ApiModule from "@/lib/utils/api";

const { mockCreateClient, mockCreateAdminClient, mockVerifyTurnstile } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockVerifyTurnstile: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/utils/turnstile", () => ({ verifyTurnstileToken: mockVerifyTurnstile }));
vi.mock("@/lib/utils/enum-compat", () => ({
  mapLegacyReportValues: vi.fn(
    ({ reason, targetType }: { reason: string; targetType: string }) => ({
      category: reason,
      targetType,
      area: "LISTINGS",
    })
  ),
}));
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

import { POST } from "@/app/api/reports/route";

const validBody = {
  reason: "scam",
  targetType: "listing",
  targetId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  description: "This listing looks very suspicious and may be a scam",
  turnstileToken: "tok",
};

function createRequest(body: unknown): NextRequest {
  return {
    method: "POST",
    json: async () => body,
    url: "http://localhost:3000/api/reports",
    headers: {
      get: vi.fn((name: string) => {
        const normalized = name.toLowerCase();
        if (normalized === "cf-connecting-ip") return "1.2.3.4";
        return null;
      }),
    },
    nextUrl: new URL("http://localhost:3000/api/reports"),
  } as unknown as NextRequest;
}

function mockAuth(user: { id: string; email?: string } | null) {
  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: user ? null : { message: "Not authenticated" },
      }),
    },
  });
}

function mockAdminInsert(error: unknown = null) {
  const mockInsert = vi.fn().mockReturnValue({ data: { id: "r1" }, error });
  mockCreateAdminClient.mockReturnValue({
    from: vi.fn().mockReturnValue({ insert: mockInsert }),
  });
  return mockInsert;
}

describe("POST /api/reports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TURNSTILE_SECRET_KEY;
    process.env.IP_HASH_SECRET = "test-hash-key";
  });

  it("returns 400 for invalid JSON", async () => {
    const req = {
      method: "POST",
      json: async () => {
        throw new Error("bad");
      },
      url: "http://localhost:3000/api/reports",
      headers: { get: vi.fn().mockReturnValue(null) },
      nextUrl: new URL("http://localhost:3000/api/reports"),
    } as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing required fields", async () => {
    const res = await POST(createRequest({}));
    expect(res.status).toBe(400);
  });

  it("succeeds with valid report data", async () => {
    mockAuth({ id: "user-1", email: "u@test.com" });
    mockAdminInsert();
    mockVerifyTurnstile.mockResolvedValue({ success: true });

    const res = await POST(createRequest(validBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("rejects failed Turnstile in production", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    mockVerifyTurnstile.mockResolvedValue({ success: false });

    const res = await POST(createRequest(validBody));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("CAPTCHA");
  });

  it("hashes IP when IP_HASH_SECRET is available", async () => {
    process.env.IP_HASH_SECRET = "test-secret";
    mockAuth({ id: "user-1", email: "u@test.com" });
    mockAdminInsert();

    const res = await POST(createRequest(validBody));
    expect(res.status).toBe(200);
  });

  it("accepts promotion-specific reasons that map to moderation categories", async () => {
    mockAuth({ id: "user-1", email: "u@test.com" });
    const insert = mockAdminInsert();

    const res = await POST(
      createRequest({
        ...validBody,
        targetType: "promotion",
        reason: "expired",
      })
    );

    expect(res.status).toBe(200);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        target_type: "promotion",
      })
    );
  });
});
