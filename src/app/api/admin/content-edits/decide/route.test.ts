import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockFrom,
  mockLogAuditEvent,
  mockCreateNotification,
  mockQueuePublicMediaCleanup,
  mockCheckLocalRateLimit,
  mockEnforceSameOriginMutation,
  mockEnforceCsrfToken,
  mockGetStaffActorRole,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockFrom: vi.fn(),
  mockLogAuditEvent: vi.fn(),
  mockCreateNotification: vi.fn(),
  mockQueuePublicMediaCleanup: vi.fn(),
  mockCheckLocalRateLimit: vi.fn(),
  mockEnforceSameOriginMutation: vi.fn<(request: Request) => Response | null>(() => null),
  mockEnforceCsrfToken: vi.fn<(request: Request) => Response | null>(() => null),
  mockGetStaffActorRole: vi.fn(() => "admin"),
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

vi.mock("@/lib/services/media-cleanup", () => ({
  collectMediaUrls: (...values: unknown[]) => values.flat().filter(Boolean),
  diffRemovedMediaUrls: (previous: string[], next: string[]) =>
    previous.filter((url) => !next.includes(url)),
  queuePublicMediaCleanup: mockQueuePublicMediaCleanup,
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: mockCheckLocalRateLimit,
}));

vi.mock("@/lib/auth/admin-access", () => ({
  verifyStaffActorRoleFromDb: vi.fn(async () => mockGetStaffActorRole()),
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

const requestId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const targetId = "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";

function createMockRequest(body: Record<string, unknown>) {
  const json = JSON.stringify(body);
  return {
    text: async () => json,
  } as unknown as Request;
}

function makeEditRequest() {
  return {
    id: requestId,
    target_type: "listing",
    target_id: targetId,
    owner_id: "owner-1",
    area: "MZANSI_MARKET",
    status: "pending",
    proposed_data: {
      title: "Updated iPhone",
      description: "Updated description",
      photos: ["new.jpg"],
      status: "live",
    },
    current_snapshot: {
      title: "Old iPhone",
      description: "Old description",
      photos: ["old.jpg"],
    },
    created_at: "2026-04-24T10:00:00.000Z",
    updated_at: "2026-04-24T10:00:00.000Z",
  };
}

describe("POST /api/admin/content-edits/decide", () => {
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
    mockQueuePublicMediaCleanup.mockResolvedValue(undefined);
  });

  it("approves a pending edit, applies proposed data, increments the edit count, and notifies the owner", async () => {
    const targetUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [{ id: targetId }], error: null }),
        }),
      }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "content_edit_requests") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: makeEditRequest(), error: null }),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        };
      }

      if (table === "listings") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: targetId, owner_id: "owner-1", status: "live", approved_edit_count: 1 },
                error: null,
              }),
            }),
          }),
          update: targetUpdate,
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    const response = await POST(createMockRequest({ requestId, decision: "approve" }));

    expect(response.status).toBe(200);
    expect(targetUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Updated iPhone",
        status: "live",
        approved_edit_count: 2,
      })
    );
    expect(mockQueuePublicMediaCleanup).toHaveBeenCalledWith(
      expect.anything(),
      ["old.jpg"],
      "content_edit_approved"
    );
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "owner-1",
        title: "Listing edit approved",
      })
    );
  });

  it("rejects a pending edit without consuming an approved edit chance", async () => {
    const requestUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [{ id: requestId }], error: null }),
        }),
      }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "content_edit_requests") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: makeEditRequest(), error: null }),
              }),
            }),
          }),
          update: requestUpdate,
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    const response = await POST(
      createMockRequest({ requestId, decision: "reject", reason: "Photo is misleading" })
    );

    expect(response.status).toBe(200);
    expect(requestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "rejected",
        reason: "Photo is misleading",
      })
    );
    expect(mockQueuePublicMediaCleanup).toHaveBeenCalledWith(
      expect.anything(),
      ["new.jpg"],
      "content_edit_rejected"
    );
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "owner-1",
        title: "Listing edit rejected",
      })
    );
  });
});
