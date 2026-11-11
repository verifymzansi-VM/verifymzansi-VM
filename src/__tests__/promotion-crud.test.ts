import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { resetOwnerColumnCacheForTesting } from "@/lib/account/compat";

// DELETE /api/promotions/[id] has no foundation path yet: it still runs the
// retired backend's owner delete (src/app/api/_lib/create-owned-content-delete-route.ts).
// GET and PUT run on foundation and are tested with the restored post routes.
const { mockCreateClient, mockCreateAdminClient, mockLogAuditEvent } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockLogAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

const { mockCheckRateLimit, mockCheckLocalRateLimit } = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn().mockResolvedValue({ limited: false }),
  mockCheckLocalRateLimit: vi.fn().mockReturnValue({ limited: false }),
}));

const { mockEnforceCsrfToken } = vi.hoisted(() => ({
  mockEnforceCsrfToken: vi.fn(),
}));

const mockDeleteOwned = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));
vi.mock("@/lib/content/delete-owned", () => ({ deleteOwnedContent: mockDeleteOwned }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent: mockLogAuditEvent }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  checkLocalRateLimit: mockCheckLocalRateLimit,
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/utils/csrf", () => ({ enforceCsrfToken: mockEnforceCsrfToken }));

import { DELETE } from "@/app/api/promotions/[id]/route";

const VALID_UUID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "user-0001";

function createRequest(url: string, opts: { method?: string; body?: unknown } = {}): NextRequest {
  return {
    method: opts.method || "GET",
    json:
      opts.body !== undefined
        ? async () => opts.body
        : async () => {
            throw new Error("No body");
          },
    headers: new Headers(),
    nextUrl: new URL(url, "http://localhost:3000"),
    url: new URL(url, "http://localhost:3000").toString(),
  } as unknown as NextRequest;
}

function mockAuth(user: { id: string; email?: string } | null) {
  mockCreateClient.mockResolvedValue({
    from: vi.fn(),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: user ? null : { message: "Not authenticated" },
      }),
    },
  });
}

describe("DELETE /api/promotions/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOwnerColumnCacheForTesting();
  });

  it("rejects unauthenticated requests", async () => {
    mockAuth(null);
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`, {
      method: "DELETE",
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 for missing promotion", async () => {
    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
      },
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`, {
      method: "DELETE",
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(404);
  });

  it("returns 400 when promotion is not draft or rejected", async () => {
    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: VALID_UUID, owner_id: USER_ID, status: "live" },
        }),
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
      },
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`, {
      method: "DELETE",
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/draft or rejected/i);
  });

  function createDeleteChain(deletedRows: Array<{ id: string }> = [{ id: VALID_UUID }]) {
    const select = vi.fn().mockResolvedValue({ data: deletedRows, error: null });
    const chain = { eq: vi.fn(), select };
    chain.eq.mockReturnValue(chain);
    return chain;
  }

  it("returns 409 when row-level security deletes zero rows", async () => {
    const deleteChain = createDeleteChain([]);
    mockDeleteOwned.mockResolvedValueOnce({
      ok: false,
      reason: "not_deletable",
      message: "This post cannot be deleted in its current state",
    });
    mockCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table === "promotions") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: VALID_UUID, owner_id: USER_ID, status: "draft" },
            }),
            delete: vi.fn().mockReturnValue(deleteChain),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
      },
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`, {
      method: "DELETE",
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/draft or rejected/i);
    expect(mockDeleteOwned).toHaveBeenCalled();
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("deletes draft promotion successfully", async () => {
    const deleteChain = createDeleteChain();
    mockCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table === "promotions") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: VALID_UUID, owner_id: USER_ID, status: "draft" },
            }),
            delete: vi.fn().mockReturnValue(deleteChain),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) }),
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`, {
      method: "DELETE",
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockDeleteOwned).toHaveBeenCalledWith(
      expect.any(String),
      VALID_UUID,
      "owner_id",
      USER_ID
    );
  });

  it("deletes rejected promotion successfully", async () => {
    const deleteChain = createDeleteChain();
    mockCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table === "promotions") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: VALID_UUID, owner_id: USER_ID, status: "rejected" },
            }),
            delete: vi.fn().mockReturnValue(deleteChain),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) }),
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`, {
      method: "DELETE",
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(200);
    expect(mockDeleteOwned).toHaveBeenCalledWith(
      expect.any(String),
      VALID_UUID,
      "owner_id",
      USER_ID
    );
  });
});
