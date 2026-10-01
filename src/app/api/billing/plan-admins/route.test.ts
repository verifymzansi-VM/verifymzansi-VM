import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const ENTITLEMENT = "11111111-1111-4111-8111-111111111111";
const USER_ID = "33333333-3333-4333-8333-333333333333";

const { guard, rpc } = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/billing/route-guard", () => ({ enforceBillingMutationGuard: guard }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { POST } from "./route";

const request = (body: unknown) =>
  new NextRequest("https://verifymzansi.com/api/billing/plan-admins", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/billing/plan-admins", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guard.mockResolvedValue({ success: true, user: { id: USER_ID } });
  });

  it("stops at the billing guard", async () => {
    guard.mockResolvedValue({
      success: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await POST(
      request({ entitlementId: ENTITLEMENT, action: "add", email: "a@b.co.za" })
    );
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("acts as the signed-in buyer", async () => {
    rpc.mockResolvedValue({ data: { entitlementId: ENTITLEMENT }, error: null });
    const res = await POST(
      request({ entitlementId: ENTITLEMENT, action: "add", email: "helper@shop.co.za" })
    );
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("owner_manage_plan_admin", {
      p_owner: USER_ID,
      p_entitlement: ENTITLEMENT,
      p_action: "add",
      p_email: "helper@shop.co.za",
    });
  });

  it("explains the two-administrator limit", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "PLAN_ADMIN_LIMIT: limit", code: "P0001" },
    });
    const res = await POST(
      request({ entitlementId: ENTITLEMENT, action: "add", email: "third@shop.co.za" })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/two named administrators/);
  });
});
