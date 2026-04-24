import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockCreateDecisionRecord,
  mockCheckLocalRateLimit,
  mockLogAuditEvent,
  mockSendAccountEnforcementEmail,
  mockVerifyStaffActorRoleFromDb,
  mockGetUserById,
  mockEnforceSameOriginMutation,
  mockEnforceCsrfToken,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockCreateDecisionRecord: vi.fn(),
  mockCheckLocalRateLimit: vi.fn(),
  mockLogAuditEvent: vi.fn().mockResolvedValue(undefined),
  mockSendAccountEnforcementEmail: vi.fn().mockResolvedValue({ success: true }),
  mockVerifyStaffActorRoleFromDb: vi.fn(),
  mockGetUserById: vi.fn(),
  mockEnforceSameOriginMutation: vi.fn(),
  mockEnforceCsrfToken: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/auth/admin-access", () => ({
  verifyStaffActorRoleFromDb: mockVerifyStaffActorRoleFromDb,
}));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent: mockLogAuditEvent }));
vi.mock("@/lib/services/email", () => ({
  sendAccountEnforcementEmail: mockSendAccountEnforcementEmail,
}));
vi.mock("@/lib/services/decision-ledger", () => ({
  createDecisionRecord: mockCreateDecisionRecord,
}));
vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: mockEnforceSameOriginMutation,
}));
vi.mock("@/lib/utils/csrf", () => ({
  enforceCsrfToken: mockEnforceCsrfToken,
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: mockCheckLocalRateLimit,
}));

import { POST } from "@/app/api/admin/flagging/action/route";

function createRequest(body: unknown, headers: Record<string, string> = {}) {
  return {
    method: "POST",
    json: async () => body,
    url: "http://localhost:3000/api/admin/flagging/action",
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? headers[name] ?? null;
      },
    },
  } as unknown as NextRequest;
}

describe("POST /api/admin/flagging/action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyStaffActorRoleFromDb.mockResolvedValue("moderator");
    mockCreateDecisionRecord.mockResolvedValue({ id: "decision-1" });
    mockEnforceSameOriginMutation.mockReturnValue(null);
    mockEnforceCsrfToken.mockReturnValue(null);
    mockCheckLocalRateLimit.mockReturnValue({ limited: false });
    mockGetUserById.mockResolvedValue({
      data: {
        user: {
          email: "owner@example.com",
          user_metadata: { full_name: "Owner Person" },
        },
      },
      error: null,
    });
  });

  it("rejects cross-site moderation requests", async () => {
    mockEnforceSameOriginMutation.mockReturnValue(
      new Response(JSON.stringify({ error: "Cross-origin request blocked" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );

    const res = await POST(
      createRequest(
        {
          reportId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
          action: "hide",
        },
        { origin: "https://evil.example" }
      )
    );

    expect(res.status).toBe(403);
  });

  it("returns 403 for non-moderators", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    });
    mockVerifyStaffActorRoleFromDb.mockResolvedValue(null);

    const res = await POST(
      createRequest({
        reportId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        action: "hide",
      })
    );

    expect(res.status).toBe(403);
  });

  it("returns 429 when moderation actions are rate limited", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "mod-1" } } }),
      },
    });
    mockVerifyStaffActorRoleFromDb.mockResolvedValue("moderator");
    mockCheckLocalRateLimit.mockReturnValue({ limited: true, retryAfter: 30 });

    const res = await POST(
      createRequest({
        reportId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        action: "hide",
      })
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    await expect(res.json()).resolves.toMatchObject({ error: "Too many requests" });
  });

  it("hides reported content and resolves the report", async () => {
    const reportsEq = vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: {
          id: "report-1",
          area: "MZANSI_MARKET",
          target_type: "listing",
          target_id: "listing-1",
        },
        error: null,
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });
    const listingsEq = vi.fn().mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({
        data: { owner_id: "owner-1" },
        error: null,
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "mod-1", app_metadata: { role: "moderator" } } },
        }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "reports") {
          return {
            select: vi.fn().mockReturnValue({
              eq: reportsEq,
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }

        if (table === "listings") {
          return {
            select: vi.fn().mockReturnValue({
              eq: listingsEq,
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }

        if (table === "moderation_actions") {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
      auth: { admin: { getUserById: mockGetUserById } },
      rpc: vi.fn().mockResolvedValue({ error: null }),
    });

    const res = await POST(
      createRequest({
        reportId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        action: "hide",
        reason: "Fraud signal",
      })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      action: "hide",
      reportStatus: "resolved",
    });
    expect(mockLogAuditEvent).toHaveBeenCalled();
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "mod-1",
        actorRole: "moderator",
      })
    );
  });

  it("sends account enforcement email for warning actions", async () => {
    const reportsEq = vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: {
          id: "report-1",
          area: "MZANSI_MARKET",
          target_type: "account_profile",
          target_id: "owner-1",
        },
        error: null,
      }),
    });

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "mod-1", app_metadata: { role: "moderator" } } },
        }),
      },
    });

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "reports") {
          return {
            select: vi.fn().mockReturnValue({ eq: reportsEq }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }

        if (table === "account_profiles") {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }

        if (table === "moderation_actions") {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
      auth: { admin: { getUserById: mockGetUserById } },
      rpc: vi.fn().mockResolvedValue({ error: null }),
    });

    const res = await POST(
      createRequest({
        reportId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        action: "warn",
        reason: "Policy warning",
      })
    );

    expect(res.status).toBe(200);
    expect(mockSendAccountEnforcementEmail).toHaveBeenCalledWith({
      email: "owner@example.com",
      accountName: "Owner Person",
      action: "warn",
      reason: "Policy warning",
      suspendedUntil: null,
    });
  });

  it("fails closed for sensitive enforcement when decision record creation fails", async () => {
    const reportsEq = vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: {
          id: "report-1",
          area: "MZANSI_MARKET",
          target_type: "account_profile",
          target_id: "owner-1",
          status: "open",
        },
        error: null,
      }),
    });
    const moderationInsert = vi.fn().mockResolvedValue({ error: null });
    const accountUpdateEq = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn().mockResolvedValue({ error: { message: "rpc missing" } });
    const contentHideEqSecond = vi.fn().mockResolvedValue({ error: null });

    const contentTableMock = {
      select: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: contentHideEqSecond,
        }),
      }),
    };

    mockCreateDecisionRecord.mockRejectedValue(new Error("ledger unavailable"));
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "mod-1", app_metadata: { role: "moderator" } } },
        }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "reports") {
          return {
            select: vi.fn().mockReturnValue({ eq: reportsEq }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }

        if (table === "account_profiles") {
          return {
            update: vi.fn().mockReturnValue({ eq: accountUpdateEq }),
          };
        }

        if (table === "listings" || table === "businesses" || table === "promotions") {
          return contentTableMock;
        }

        if (table === "moderation_actions") {
          return {
            insert: moderationInsert,
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
      auth: { admin: { getUserById: mockGetUserById } },
      rpc,
    });

    const res = await POST(
      createRequest({
        reportId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        action: "suspend",
        reason: "Escalation fallback",
        durationDays: 3,
      })
    );

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: "Decision approval workflow unavailable",
      code: "decision_workflow_unavailable",
    });
    expect(mockCreateDecisionRecord).toHaveBeenCalled();
    expect(moderationInsert).not.toHaveBeenCalled();
    expect(accountUpdateEq).not.toHaveBeenCalled();
  });

  it("uses the DB-verified role, not a stale JWT role, for sensitive enforcement approval", async () => {
    const reportsEq = vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: {
          id: "report-1",
          area: "MZANSI_MARKET",
          target_type: "account_profile",
          target_id: "owner-1",
          status: "open",
        },
        error: null,
      }),
    });
    const recommendedInsert = vi.fn().mockResolvedValue({ error: null });

    mockVerifyStaffActorRoleFromDb.mockResolvedValue("moderator");
    mockCreateDecisionRecord.mockResolvedValue({ id: "decision-1" });
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "mod-1", app_metadata: { role: "admin" } } },
        }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "reports") {
          return {
            select: vi.fn().mockReturnValue({ eq: reportsEq }),
          };
        }

        if (table === "moderation_actions") {
          return {
            insert: recommendedInsert,
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
      auth: { admin: { getUserById: mockGetUserById } },
      rpc: vi.fn().mockResolvedValue({ error: null }),
    });

    const res = await POST(
      createRequest({
        reportId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        action: "ban",
        reason: "Stale JWT should not approve",
      })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      action: "ban_recommended",
      status: "pending_approval",
      decisionRecordId: "decision-1",
    });
    expect(mockCreateDecisionRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        recommenderRole: "moderator",
      })
    );
    expect(recommendedInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ban_recommended",
        target_owner_id: "owner-1",
      })
    );
  });

  it("returns 500 when moderation_actions audit trail insert fails", async () => {
    const reportsEq = vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: {
          id: "report-1",
          area: "MZANSI_MARKET",
          target_type: "listing",
          target_id: "listing-1",
        },
        error: null,
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });
    const listingsEq = vi.fn().mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({
        data: { owner_id: "owner-1" },
        error: null,
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "mod-1", app_metadata: { role: "moderator" } } },
        }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "reports") {
          return {
            select: vi.fn().mockReturnValue({
              eq: reportsEq,
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }

        if (table === "listings") {
          return {
            select: vi.fn().mockReturnValue({
              eq: listingsEq,
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }

        if (table === "moderation_actions") {
          return {
            insert: vi.fn().mockResolvedValue({
              error: { message: "moderation_actions insert failed" },
            }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
      auth: { admin: { getUserById: mockGetUserById } },
      rpc: vi.fn().mockResolvedValue({ error: null }),
    });

    const res = await POST(
      createRequest({
        reportId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        action: "hide",
        reason: "Audit trail failure test",
      })
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      error: "Failed to record enforcement action",
    });
  });

  it("rejects CSRF-invalid moderation requests before DB access", async () => {
    mockEnforceCsrfToken.mockReturnValue(
      new Response(JSON.stringify({ error: "CSRF token missing or invalid" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );

    const res = await POST(
      createRequest({
        reportId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        action: "hide",
      })
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("CSRF") });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("returns 401 when no user is authenticated", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });

    const res = await POST(
      createRequest({
        reportId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        action: "hide",
      })
    );

    expect(res.status).toBe(401);
  });

  it("returns 404 when report lookup returns null (not found)", async () => {
    const reportsEq = vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "Row not found", code: "PGRST116" },
      }),
    });

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "mod-1", app_metadata: { role: "moderator" } } },
        }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "reports") {
          return {
            select: vi.fn().mockReturnValue({ eq: reportsEq }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
      auth: { admin: { getUserById: mockGetUserById } },
      rpc: vi.fn().mockResolvedValue({ error: null }),
    });

    const res = await POST(
      createRequest({
        reportId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        action: "hide",
      })
    );

    expect(res.status).toBe(404);
  });

  it("returns 404 when owner-targeted enforcement has no account holder", async () => {
    const reportsEq = vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: {
          id: "report-1",
          area: "MZANSI_MARKET",
          target_type: "listing",
          target_id: "listing-1",
        },
        error: null,
      }),
    });
    const listingsEq = vi.fn().mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({
        data: null,
        error: null,
      }),
    });

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "mod-1", app_metadata: { role: "moderator" } } },
        }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "reports") {
          return {
            select: vi.fn().mockReturnValue({ eq: reportsEq }),
          };
        }

        if (table === "listings") {
          return {
            select: vi.fn().mockReturnValue({ eq: listingsEq }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
      auth: { admin: { getUserById: mockGetUserById } },
      rpc: vi.fn().mockResolvedValue({ error: null }),
    });

    const res = await POST(
      createRequest({
        reportId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        action: "warn",
        reason: "Owner missing",
      })
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      error: "Target content not found or has no associated account holder",
    });
  });
});
