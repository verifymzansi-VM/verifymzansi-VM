import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateClient, mockCheckRateLimit } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCheckRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

import { POST } from "@/app/api/profile/update/route";

const CSRF_TOKEN = "a".repeat(64);

function createRequest(body: unknown, headers: Record<string, string> = {}) {
  const lowered = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  ) as Record<string, string>;

  const mergedHeaders: Record<string, string> = {
    origin: "http://localhost:3000",
    cookie: `vm_csrf=${CSRF_TOKEN}`,
    "x-csrf-token": CSRF_TOKEN,
    ...lowered,
  };

  return {
    method: "POST",
    json: async () => body,
    url: "http://localhost:3000/api/profile/update",
    nextUrl: new URL("http://localhost:3000/api/profile/update"),
    headers: {
      get(name: string) {
        return mergedHeaders[name.toLowerCase()] ?? null;
      },
    },
  } as unknown as NextRequest;
}

describe("POST /api/profile/update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ limited: false });
  });

  it("rejects cross-site profile updates", async () => {
    const res = await POST(
      createRequest(
        {
          displayName: "Nomsa",
          bio: "Hello there",
        },
        { origin: "https://evil.example" }
      )
    );

    expect(res.status).toBe(403);
  });

  it("requires an authenticated user", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    });

    const res = await POST(createRequest({ displayName: "Nomsa" }));

    expect(res.status).toBe(401);
  });

  it("rejects requests without a CSRF token", async () => {
    const res = await POST(
      createRequest(
        {
          displayName: "Nomsa",
        },
        {
          origin: "http://localhost:3000",
          cookie: "",
          "x-csrf-token": "",
        }
      )
    );

    expect(res.status).toBe(403);
  });

  it("returns 409 when the new phone number is already used elsewhere", async () => {
    const updateSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });

    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: updateSingle,
            }),
          }),
        }),
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
      },
    });

    const res = await POST(
      createRequest({
        displayName: "Nomsa",
        phone: "+27821234567",
      })
    );

    expect(res.status).toBe(409);
  });

  it("updates the profile successfully", async () => {
    const updateSingle = vi.fn().mockResolvedValue({
      data: { user_id: "user-1", display_name: "Nomsa" },
      error: null,
    });
    const from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: updateSingle,
          }),
        }),
      }),
    });

    mockCreateClient.mockResolvedValue({
      from,
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
    });

    const res = await POST(
      createRequest({
        displayName: "Nomsa",
        bio: "Trusted seller",
        province: "Gauteng",
        city: "Johannesburg",
      })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      profile: expect.objectContaining({ display_name: "Nomsa" }),
    });
  });
});
