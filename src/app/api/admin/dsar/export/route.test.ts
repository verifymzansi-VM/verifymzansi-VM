import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockLogAuditEvent,
  mockGetOwnerColumn,
  mockVerifyAdminActorRoleFromDb,
  mockCheckLocalRateLimit,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockLogAuditEvent: vi.fn(),
  mockGetOwnerColumn: vi.fn(),
  mockVerifyAdminActorRoleFromDb: vi.fn(),
  mockCheckLocalRateLimit: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/services/audit", () => ({
  logAuditEvent: mockLogAuditEvent,
}));

vi.mock("@/lib/auth/admin-access", () => ({
  verifyAdminActorRoleFromDb: mockVerifyAdminActorRoleFromDb,
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: mockCheckLocalRateLimit,
}));

vi.mock("@/lib/account/compat", async () => {
  const actual = await vi.importActual("@/lib/account/compat");
  return {
    ...actual,
    getOwnerColumn: mockGetOwnerColumn,
  };
});

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { GET } from "./route";

function createRequest(url: string) {
  return {
    nextUrl: new URL(url),
  } as unknown as Request;
}

function createQueryBuilder(response: { data: unknown; error?: unknown }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(response),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(response),
    or: vi.fn().mockReturnThis(),
  };
}

describe("GET /api/admin/dsar/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOwnerColumn.mockResolvedValue("owner_id");
    mockLogAuditEvent.mockResolvedValue(undefined);
    mockVerifyAdminActorRoleFromDb.mockResolvedValue("admin");
    mockCheckLocalRateLimit.mockReturnValue({ limited: false });
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "admin-1", app_metadata: { role: "admin" } } },
        }),
      },
    });

    const tableData: Record<string, unknown> = {
      dsar_cases: {
        data: {
          id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
          type: "access",
          requester_email: "nomsa@example.com",
          requester_phone: "not_provided",
          identity_verified: false,
          description: "Requested account data",
          status: "in_progress",
          due_by: "2026-04-16T00:00:00.000Z",
          completed_at: null,
          response_summary: null,
          processed_by: null,
          created_at: "2026-03-17T00:00:00.000Z",
          updated_at: "2026-03-17T00:00:00.000Z",
        },
        error: null,
      },
      audit_logs: {
        data: [
          {
            id: "audit-1",
            actor_id: "admin-1",
            actor_role: "admin",
            action: "dsar_requested",
            target_type: "dsar_case",
            target_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            area: null,
            metadata: {},
            created_at: "2026-03-17T00:01:00.000Z",
          },
        ],
        error: null,
      },
      account_profiles: {
        data: {
          id: "profile-1",
          user_id: "user-1",
          display_name: "Nomsa Dlamini",
          account_verification_status: "verified",
        },
        error: null,
      },
      verification_steps: { data: [], error: null },
      kyc_artifacts: { data: [], error: null },
      listings: { data: [{ id: "listing-1", title: "Honda Jazz" }], error: null },
      businesses: { data: [], error: null },
      promotions: { data: [], error: null },
      contact_events: { data: [], error: null },
      payments: { data: [{ id: "payment-1", amount_cents: 19900 }], error: null },
    };

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) =>
        createQueryBuilder(tableData[table] as { data: unknown; error?: unknown })
      ),
      auth: {
        admin: {
          getUserById: vi.fn().mockResolvedValue({
            data: { user: { id: "admin-1", app_metadata: { role: "admin" } } },
            error: null,
          }),
          listUsers: vi.fn().mockResolvedValue({
            data: { users: [{ id: "user-1", email: "nomsa@example.com" }] },
            error: null,
          }),
        },
      },
    });
  });

  it("returns a constrained JSON export package for a matched requester", async () => {
    const response = await GET(
      createRequest(
        "http://localhost:3000/api/admin/dsar/export?requestId=a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
      ) as never
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    const payload = await response.json();
    expect(payload.identityResolution).toMatchObject({
      status: "matched",
      matchedUserId: "user-1",
    });
    expect(payload.data.accountProfile).toMatchObject({ display_name: "Nomsa Dlamini" });
    expect(payload.data.listings).toHaveLength(1);
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "dsar_exported",
        actorRole: "admin",
      })
    );
  });

  it("returns 400 for an invalid request id", async () => {
    const response = await GET(
      createRequest("http://localhost:3000/api/admin/dsar/export?requestId=bad-id") as never
    );

    expect(response.status).toBe(400);
  });

  it("caps auth user lookup to five pages", async () => {
    const listUsers = vi
      .fn()
      .mockResolvedValue({
        data: { users: Array.from({ length: 200 }, (_, i) => ({ id: `u${i}` })) },
        error: null,
      });

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "dsar_cases") {
          return createQueryBuilder({
            data: {
              id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
              requester_email: "nomsa@example.com",
            },
            error: null,
          });
        }
        if (table === "audit_logs") {
          return createQueryBuilder({ data: [], error: null });
        }
        return createQueryBuilder({ data: [], error: null });
      }),
      auth: {
        admin: {
          listUsers,
        },
      },
    });

    const response = await GET(
      createRequest(
        "http://localhost:3000/api/admin/dsar/export?requestId=a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
      ) as never
    );

    expect(response.status).toBe(200);
    expect(listUsers).toHaveBeenCalledTimes(5);
  });
});
