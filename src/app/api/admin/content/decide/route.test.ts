import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockFrom,
  mockLogAuditEvent,
  mockCreateNotification,
  mockCheckLocalRateLimit,
  mockEnforceSameOriginMutation,
  mockEnforceCsrfToken,
  mockGetStaffActorRole,
  mockGetOwnerColumn,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockFrom: vi.fn(),
  mockLogAuditEvent: vi.fn(),
  mockCreateNotification: vi.fn(),
  mockCheckLocalRateLimit: vi.fn(),
  mockEnforceSameOriginMutation: vi.fn<(request: Request) => Response | null>(() => null),
  mockEnforceCsrfToken: vi.fn<(request: Request) => Response | null>(() => null),
  mockGetStaffActorRole: vi.fn(() => "admin"),
  mockGetOwnerColumn: vi.fn(async () => "owner_id"),
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

vi.mock("@/lib/notifications", () => ({
  createNotification: mockCreateNotification,
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: mockCheckLocalRateLimit,
}));

vi.mock("@/lib/auth/admin-access", () => ({
  verifyStaffActorRoleFromDb: vi.fn(async () => mockGetStaffActorRole()),
}));

vi.mock("@/lib/account/compat", () => ({
  getOwnerColumn: mockGetOwnerColumn,
  readOwnerId: (record: Record<string, unknown>) =>
    (record.owner_id as string | null | undefined) ??
    (record.seller_id as string | null | undefined) ??
    null,
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: mockEnforceSameOriginMutation,
}));

vi.mock("@/lib/utils/csrf", () => ({
  enforceCsrfToken: mockEnforceCsrfToken,
}));

import { POST } from "./route";

function createMockRequest(body: Record<string, unknown>) {
  const json = JSON.stringify(body);
  return {
    text: async () => json,
  } as unknown as Request;
}

describe("POST /api/admin/content/decide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "admin-1", app_metadata: { role: "admin" } } },
        }),
      },
    });
    mockCreateAdminClient.mockReturnValue({ from: mockFrom });
    mockCheckLocalRateLimit.mockReturnValue({ limited: false });
    mockEnforceSameOriginMutation.mockReturnValue(null);
    mockEnforceCsrfToken.mockReturnValue(null);
    mockLogAuditEvent.mockResolvedValue(undefined);
    mockCreateNotification.mockResolvedValue(true);
  });

  it("rejects cross-origin moderation requests before auth or body parsing", async () => {
    mockEnforceSameOriginMutation.mockReturnValue(
      new Response(JSON.stringify({ error: "Cross-origin request blocked" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );

    const response = await POST(
      createMockRequest({
        itemId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        area: "PROMOTIONS_EVENTS",
        decision: "approve",
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Cross-origin request blocked" });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("approves promotions surfaced in the moderation queue", async () => {
    const itemId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

    mockFrom.mockImplementation((table: string) => {
      if (table === "promotions") {
        const eqStatus = vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [{ id: itemId }], error: null }),
        });
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ eq: eqStatus }),
          }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  owner_id: "owner-1",
                  title: "Weekend Promo Blast",
                },
                error: null,
              }),
            }),
          }),
        };
      }

      return {};
    });

    const response = await POST(
      createMockRequest({
        itemId,
        area: "PROMOTIONS_EVENTS",
        decision: "approve",
      })
    );

    expect(response.status).toBe(200);
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "moderation_action",
        targetType: "promotion",
        targetId: itemId,
      })
    );
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "owner-1",
        title: "Promotion approved!",
        href: "/dashboard/tourism-events",
      })
    );
  });

  it("rejects businesses surfaced in the moderation queue", async () => {
    const itemId = "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";

    mockFrom.mockImplementation((table: string) => {
      if (table === "businesses") {
        const eqStatus = vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [{ id: itemId }], error: null }),
        });
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ eq: eqStatus }),
          }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  owner_id: "owner-2",
                  business_name: "Trusted Plumbing Co",
                },
                error: null,
              }),
            }),
          }),
        };
      }

      return {};
    });

    const response = await POST(
      createMockRequest({
        itemId,
        area: "MZANSI_BUSINESS",
        decision: "reject",
        reason: "Missing contact details",
      })
    );

    expect(response.status).toBe(200);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "owner-2",
        title: "Business rejected",
        href: "/dashboard/businesses",
      })
    );
  });
});
