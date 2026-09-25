import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetUser = vi.fn();
const mockRpc = vi.fn();
const mockAudit = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mockGetUser } })),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mockRpc }) }));
vi.mock("@/lib/services/audit", () => ({
  logAuditEvent: (...args: unknown[]) => mockAudit(...args),
}));
vi.mock("@/lib/utils/mutation-guard", () => ({ enforceMutationRequest: () => null }));
vi.mock("@/lib/utils/rate-limit", () => ({ checkLocalRateLimit: () => ({ limited: false }) }));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { POST } from "./route";

const ID = "550e8400-e29b-41d4-a716-446655440000";
const request = (body: unknown) =>
  new Request("http://localhost/api/content/lifecycle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/content/lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  });

  it("requires sign-in", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(request({ contentType: "listing", id: ID, action: "mark_sold" }));
    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("marks a listing sold through the owner-scoped RPC and audits it", async () => {
    mockRpc.mockResolvedValue({ data: "sold", error: null });
    const res = await POST(request({ contentType: "listing", id: ID, action: "mark_sold" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "sold" });
    expect(mockRpc).toHaveBeenCalledWith("owner_content_action", {
      p_user: "user-1",
      p_table: "listings",
      p_content: ID,
      p_action: "mark_sold",
    });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "content_lifecycle_changed", targetId: ID })
    );
  });

  it("explains a full slot pool", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "SLOT_FULL: All active posting slots" },
    });
    const res = await POST(request({ contentType: "business", id: ID, action: "reactivate" }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("SLOT_FULL");
  });

  it("points expired members without a plan to pricing", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "TRIAL_EXPIRED: Paid renewal required" },
    });
    const res = await POST(request({ contentType: "listing", id: ID, action: "reactivate" }));
    expect(res.status).toBe(402);
    expect((await res.json()).upgradeUrl).toBe("/pricing");
  });

  it("rejects unknown actions before touching the database", async () => {
    const res = await POST(request({ contentType: "listing", id: ID, action: "extend_forever" }));
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
