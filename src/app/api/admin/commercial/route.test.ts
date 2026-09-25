import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGuard = vi.fn();
const mockCapability = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/utils/admin-route-guard", () => ({
  enforceAdminMutationGuard: (...args: unknown[]) => mockGuard(...args),
}));
vi.mock("@/lib/auth/admin-access", () => ({
  verifyCapabilityFromDb: (...args: unknown[]) => mockCapability(...args),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mockRpc }) }));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { POST } from "./route";

const request = (body: unknown) =>
  new Request("http://localhost/api/admin/commercial", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/admin/commercial", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGuard.mockResolvedValue({ success: true, user: { id: "staff-1" }, actorRole: "admin" });
    mockCapability.mockResolvedValue(true);
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  it("requires the capability for the specific action", async () => {
    mockCapability.mockResolvedValue(false);
    const res = await POST(
      request({
        action: "payment.reverse",
        paymentId: crypto.randomUUID(),
        kind: "refunded",
        reason: "Refund approved",
      })
    );
    expect(res.status).toBe(403);
    expect(mockCapability).toHaveBeenCalledWith({ id: "staff-1" }, "payments:refund");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("validates setting values before calling the database", async () => {
    const res = await POST(
      request({
        action: "settings.update",
        key: "partner",
        value: { commissionBps: 90000, pendingDays: 30, enabled: true },
        reason: "Raise rate",
      })
    );
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("requires an audit reason", async () => {
    const res = await POST(
      request({ action: "trial.override", userId: crypto.randomUUID(), kind: "NONE", reason: "no" })
    );
    expect(res.status).toBe(400);
  });

  it("passes programme grants to the audited RPC", async () => {
    const userId = crypto.randomUUID();
    mockRpc.mockResolvedValue({ data: "contract-1", error: null });
    const res = await POST(
      request({
        action: "programme.grant",
        userId,
        type: "FOUNDING_COMMERCIAL_PARTNER",
        values: { slotCapacity: 25 },
        reason: "Anchor dealership for launch area",
      })
    );
    expect(res.status).toBe(200);
    expect(mockCapability).toHaveBeenCalledWith({ id: "staff-1" }, "contracts:manage");
    expect(mockRpc).toHaveBeenCalledWith("grant_programme_contract", {
      p_actor: "staff-1",
      p_user: userId,
      p_type: "FOUNDING_COMMERCIAL_PARTNER",
      p_values: { slotCapacity: 25 },
      p_reason: "Anchor dealership for launch area",
      p_override: false,
    });
  });

  it("explains stacking refusals from the database", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "PROGRAMME_ALREADY_USED: PUBLIC_7_DAY" },
    });
    const res = await POST(
      request({
        action: "programme.grant",
        userId: crypto.randomUUID(),
        type: "STRATEGIC_INDIVIDUAL",
        values: {},
        reason: "Invite a strong seller",
      })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already received/);
  });
});
