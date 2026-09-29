import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateClient, mockCreateAdminClient, mockCheckRateLimit } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockCheckRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
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

/**
 * The profile UPDATE is performed with the admin client (reads of the current
 * profile still use the user-scoped client from the route prelude).
 */
function mockAdminClient(
  updateResult: { data: unknown; error: unknown } = { data: null, error: null },
  auditInsert = vi.fn().mockResolvedValue({ error: null })
) {
  const updateMaybeSingle = vi.fn().mockResolvedValue(updateResult);
  const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle });
  const updateEq = vi.fn().mockReturnValue({ select: updateSelect });
  const update = vi.fn().mockReturnValue({ eq: updateEq });
  const from = vi.fn((table: string) => {
    if (table === "account_profiles") {
      return { update };
    }
    if (table === "profile_change_history") {
      return { insert: auditInsert };
    }
    return {};
  });
  mockCreateAdminClient.mockReturnValue({ from });
  return { from, update, updateEq, updateMaybeSingle, auditInsert };
}

describe("POST /api/profile/update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockAdminClient();
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
    const { update } = mockAdminClient({
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });

    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockReturnValue({
        // Profile pre-fetch: select().eq().maybeSingle() → no profile (no locks apply)
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
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
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ pending_phone: "+27821234567" }));
  });

  it("updates the profile successfully", async () => {
    const { update, updateEq, auditInsert } = mockAdminClient({
      data: {
        user_id: "user-1",
        display_name: "Nomsa",
        location_province: "Gauteng",
        location_city: "Johannesburg",
      },
      error: null,
    });
    const userScopedUpdate = vi.fn();
    const from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          legal_name_locked_at: null,
          location_verified_at: null,
          account_verification_status: "verified",
          phone: null,
          contact_last_phone_change_at: null,
          location_province: "Free State",
          location_city: "Sasolburg",
        },
        error: null,
      }),
      update: userScopedUpdate,
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
    expect(mockCheckRateLimit).toHaveBeenNthCalledWith(2, {
      key: "user-1",
      action: "profile:update",
    });
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      profile: expect.objectContaining({
        display_name: "Nomsa",
        location_province: "Gauteng",
        location_city: "Johannesburg",
      }),
    });
    expect(auditInsert).toHaveBeenCalledWith({
      user_id: "user-1",
      change_type: "location",
      old_value: { province: "Free State", city: "Sasolburg" },
      new_value: { province: "Gauteng", city: "Johannesburg" },
      source: "user",
    });
    // The write goes through the admin client, scoped to the signed-in user.
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        display_name: "Nomsa",
        bio: "Trusted seller",
        location_province: "Gauteng",
        location_city: "Johannesburg",
      })
    );
    expect(updateEq).toHaveBeenCalledWith("user_id", "user-1");
    expect(userScopedUpdate).not.toHaveBeenCalled();
  });

  it("does not update or log location changes after location verification", async () => {
    const { update, auditInsert } = mockAdminClient({
      data: {
        user_id: "user-1",
        display_name: "Nomsa",
        location_province: "Free State",
        location_city: "Sasolburg",
      },
      error: null,
    });

    const from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          legal_name_locked_at: null,
          location_verified_at: "2026-04-20T10:00:00.000Z",
          account_verification_status: "verified",
          phone: null,
          contact_last_phone_change_at: null,
          location_province: "Free State",
          location_city: "Sasolburg",
        },
        error: null,
      }),
    });

    mockCreateClient.mockResolvedValue({
      from,
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
      },
    });

    const res = await POST(
      createRequest({ displayName: "Nomsa", province: "Gauteng", city: "Johannesburg" })
    );

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.not.objectContaining({
        location_province: expect.anything(),
        location_city: expect.anything(),
      })
    );
    expect(auditInsert).not.toHaveBeenCalled();
  });

  it("falls back to legacy profile select when policy columns are missing", async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: "PGRST204",
          message:
            "Could not find the 'legal_name_locked_at' column of 'account_profiles' in the schema cache",
        },
      })
      .mockResolvedValueOnce({
        data: {
          account_verification_status: "pending_review",
          phone: "+27821234567",
        },
        error: null,
      });

    const { update } = mockAdminClient({
      data: { user_id: "user-1", display_name: "Nomsa" },
      error: null,
    });

    const from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle,
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
      })
    );

    expect(res.status).toBe(200);
    expect(maybeSingle).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("returns 403 when phone is changed but account is not verified", async () => {
    const from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          legal_name_locked_at: null,
          location_verified_at: null,
          account_verification_status: "pending_review",
          phone: "+27821234567",
          contact_last_phone_change_at: null,
        },
        error: null,
      }),
    });

    mockCreateClient.mockResolvedValue({
      from,
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
      },
    });

    const { update } = mockAdminClient();

    const res = await POST(createRequest({ displayName: "Nomsa", phone: "+27829876543" }));

    expect(res.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({ code: "PHONE_REVERIFICATION_REQUIRED" });
  });

  it("does not enforce phone re-verification when phone is unchanged", async () => {
    const { update } = mockAdminClient({
      data: { user_id: "user-1", display_name: "Nomsa" },
      error: null,
    });

    const from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          legal_name_locked_at: null,
          location_verified_at: null,
          account_verification_status: "pending_review",
          phone: "+27821234567",
          contact_last_phone_change_at: null,
        },
        error: null,
      }),
    });

    mockCreateClient.mockResolvedValue({
      from,
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
      },
    });

    const res = await POST(createRequest({ displayName: "Nomsa", phone: "+27821234567" }));

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.not.objectContaining({ pending_phone: expect.anything() })
    );
  });

  it("returns 429 when phone is changed within the 15-day cooldown window", async () => {
    // Set last change to 5 days ago — still within the 15-day window
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

    const from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          legal_name_locked_at: null,
          location_verified_at: null,
          account_verification_status: "verified",
          phone: "+27821234567",
          contact_last_phone_change_at: fiveDaysAgo,
        },
        error: null,
      }),
    });

    mockCreateClient.mockResolvedValue({
      from,
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
      },
    });

    const { update } = mockAdminClient();

    const res = await POST(createRequest({ displayName: "Nomsa", phone: "+27829876543" }));

    expect(res.status).toBe(429);
    expect(update).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({ code: "PHONE_COOLDOWN" });
  });

  it("returns 403 POLICY_VIOLATION when the DB trigger rejects a locked field change", async () => {
    mockAdminClient({
      data: null,
      error: { code: "P0001", message: "identity lock violation" },
    });

    const from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    mockCreateClient.mockResolvedValue({
      from,
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
      },
    });

    const res = await POST(createRequest({ displayName: "Tampered Name" }));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "POLICY_VIOLATION" });
  });

  describe("avatarUrl validation", () => {
    const SUPABASE_URL = "https://project.supabase.co";
    const AVATARS_BASE = `${SUPABASE_URL}/storage/v1/object/public/avatars`;

    function mockUserClientWithoutProfile() {
      const from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      });
      mockCreateClient.mockResolvedValue({
        from,
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
        },
      });
      return { from };
    }

    beforeEach(() => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("rejects avatar URLs outside this project's avatars bucket", async () => {
      mockUserClientWithoutProfile();
      const { update } = mockAdminClient();

      const res = await POST(
        createRequest({ displayName: "Nomsa", avatarUrl: "https://evil.example/avatar.png" })
      );

      expect(res.status).toBe(400);
      expect(update).not.toHaveBeenCalled();
    });

    it("rejects avatar URLs in another member's avatars folder before reading the profile", async () => {
      const { from: userFrom } = mockUserClientWithoutProfile();
      const { update } = mockAdminClient();

      const res = await POST(
        createRequest({
          displayName: "Nomsa",
          avatarUrl: `${AVATARS_BASE}/user-2/avatar.jpg`,
        })
      );

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ error: "Invalid avatar URL" });
      expect(update).not.toHaveBeenCalled();
      expect(userFrom).not.toHaveBeenCalled();
    });

    it("accepts avatar URLs in the caller's own avatars folder and writes them via the admin client", async () => {
      mockUserClientWithoutProfile();
      const avatarUrl = `${AVATARS_BASE}/user-1/avatar.jpg?v=123`;
      const { update, updateEq } = mockAdminClient({
        data: { user_id: "user-1", display_name: "Nomsa", avatar_url: avatarUrl },
        error: null,
      });

      const res = await POST(createRequest({ displayName: "Nomsa", avatarUrl }));

      expect(res.status).toBe(200);
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ avatar_url: avatarUrl }));
      expect(updateEq).toHaveBeenCalledWith("user_id", "user-1");
    });
  });
});
