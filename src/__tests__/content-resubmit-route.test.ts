import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateClient, mockCreateAdminClient, mockLogAuditEvent } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockLogAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent: mockLogAuditEvent }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: () => ({ limited: false }),
}));
vi.mock("@/lib/utils/csrf", () => ({ enforceCsrfToken: vi.fn().mockReturnValue(null) }));

import { POST } from "@/app/api/content/resubmit/route";

function createRequest(body: unknown): NextRequest {
  return {
    method: "POST",
    json: async () => body,
    headers: { get: vi.fn().mockReturnValue(null) },
  } as unknown as NextRequest;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a fluent mock chain that resolves `maybeSingle` with the given value.
 * All intermediate methods return `this` so chained calls compile correctly.
 */
function makeAuditLogChain(maybeSingleResult: { data: unknown; error: unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  const noop = () => chain;
  chain.select = noop;
  chain.eq = noop;
  chain.filter = noop;
  chain.order = noop;
  chain.limit = noop;
  chain.maybeSingle = vi.fn().mockResolvedValue(maybeSingleResult);
  return chain;
}

function makeAuditAdminMock(auditChain: ReturnType<typeof makeAuditLogChain>) {
  return {
    from: vi.fn((table: string) => {
      if (table === "audit_logs") return auditChain;
      throw new Error(`Unexpected admin table in audit mock: ${table}`);
    }),
  };
}

const ITEM_UUID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

describe("POST /api/content/resubmit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Existing: compat-table happy path ─────────────────────────────────

  it("resubmits MZANSI_BUSINESS items using owner-column compatibility", async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn((table: string) => {
      if (table === "businesses") {
        return {
          select: vi.fn((fields?: string) => {
            if (fields === "id, owner_id") {
              return {
                limit: vi.fn().mockResolvedValue({
                  error: { code: "42703", message: "column businesses.owner_id does not exist" },
                }),
              };
            }
            if (fields === "id, seller_id") {
              return { limit: vi.fn().mockResolvedValue({ error: null }) };
            }
            return {
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: "business-1",
                  status: "rejected",
                  seller_id: "user-1",
                  updated_at: "2026-01-01T12:00:00.000Z",
                },
                error: null,
              }),
            };
          }),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: "business-1",
              status: "rejected",
              seller_id: "user-1",
              updated_at: "2026-01-01T12:00:00.000Z",
            },
            error: null,
          }),
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    mockCreateClient.mockResolvedValue({
      from,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    });
    // No prior rejection in audit log → fail open → allow
    mockCreateAdminClient.mockReturnValue(
      makeAuditAdminMock(makeAuditLogChain({ data: null, error: null }))
    );

    const response = await POST(createRequest({ itemId: ITEM_UUID, area: "MZANSI_BUSINESS" }));

    expect(response.status).toBe(200);
    expect(updateEq).toHaveBeenCalledWith("id", ITEM_UUID);
    expect(mockLogAuditEvent).toHaveBeenCalled();
  });

  // ── Existing: 404 for invisible item ──────────────────────────────────

  it("returns 404 when the owned item is not visible through the user-scoped client", async () => {
    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
      }),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    });
    // 404 fires before audit check; mock is defensive
    mockCreateAdminClient.mockReturnValue(
      makeAuditAdminMock(makeAuditLogChain({ data: null, error: null }))
    );

    const response = await POST(createRequest({ itemId: ITEM_UUID, area: "MZANSI_MARKET" }));

    expect(response.status).toBe(404);
  });

  // ── B2: content-change guard (new tests) ──────────────────────────────

  it("returns 400 when content was NOT edited after the last rejection", async () => {
    // item.updated_at (T) < rejection audit log created_at (T+1 min)
    const rejectedAt = "2026-01-01T10:01:00.000Z";
    const itemUpdatedAt = "2026-01-01T10:00:00.000Z";

    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: "listing-1",
            status: "rejected",
            seller_id: "user-2",
            updated_at: itemUpdatedAt,
          },
          error: null,
        }),
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      }),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-2" } } }) },
    });
    mockCreateAdminClient.mockReturnValue(
      makeAuditAdminMock(makeAuditLogChain({ data: { created_at: rejectedAt }, error: null }))
    );

    const response = await POST(createRequest({ itemId: ITEM_UUID, area: "MZANSI_MARKET" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/no changes detected/i);
  });

  it("allows resubmit when content WAS edited after the last rejection", async () => {
    // item.updated_at (T+2) > rejection audit log created_at (T+1) → allow
    const rejectedAt = "2026-01-01T10:01:00.000Z";
    const editedAt = "2026-01-01T10:03:00.000Z";

    const updateEq = vi.fn().mockResolvedValue({ error: null });
    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: "listing-2",
            status: "rejected",
            seller_id: "user-3",
            updated_at: editedAt,
          },
          error: null,
        }),
        update: vi.fn().mockReturnValue({ eq: updateEq }),
      }),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-3" } } }) },
    });
    mockCreateAdminClient.mockReturnValue(
      makeAuditAdminMock(makeAuditLogChain({ data: { created_at: rejectedAt }, error: null }))
    );

    const response = await POST(createRequest({ itemId: ITEM_UUID, area: "MZANSI_MARKET" }));

    expect(response.status).toBe(200);
    expect(updateEq).toHaveBeenCalled();
    expect(mockLogAuditEvent).toHaveBeenCalled();
  });

  it("allows resubmit when audit_logs has no rejection entry (legacy items, fail open)", async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: "legacy-listing",
            status: "rejected",
            seller_id: "user-4",
            updated_at: "2024-01-01T00:00:00.000Z",
          },
          error: null,
        }),
        update: vi.fn().mockReturnValue({ eq: updateEq }),
      }),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-4" } } }) },
    });
    // data: null → no prior rejection found → wasEditedAfterRejection returns true
    mockCreateAdminClient.mockReturnValue(
      makeAuditAdminMock(makeAuditLogChain({ data: null, error: null }))
    );

    const response = await POST(createRequest({ itemId: ITEM_UUID, area: "MZANSI_MARKET" }));

    expect(response.status).toBe(200);
  });

  it("allows resubmit when audit_logs query itself errors (fail open)", async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: "listing-x",
            status: "rejected",
            seller_id: "user-5",
            updated_at: "2026-01-01T10:00:00.000Z",
          },
          error: null,
        }),
        update: vi.fn().mockReturnValue({ eq: updateEq }),
      }),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-5" } } }) },
    });
    // error returned → wasEditedAfterRejection returns true → allow
    mockCreateAdminClient.mockReturnValue(
      makeAuditAdminMock(
        makeAuditLogChain({ data: null, error: { message: "connection error", code: "08006" } })
      )
    );

    const response = await POST(createRequest({ itemId: ITEM_UUID, area: "MZANSI_MARKET" }));

    expect(response.status).toBe(200);
  });

  it("returns 400 when status is not rejected (before content-change check runs)", async () => {
    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: "listing-live",
            status: "live",
            seller_id: "user-6",
            updated_at: "2026-01-01T10:00:00.000Z",
          },
          error: null,
        }),
      }),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-6" } } }) },
    });
    mockCreateAdminClient.mockReturnValue(
      makeAuditAdminMock(makeAuditLogChain({ data: null, error: null }))
    );

    const response = await POST(createRequest({ itemId: ITEM_UUID, area: "MZANSI_MARKET" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/only rejected content/i);
  });
});
