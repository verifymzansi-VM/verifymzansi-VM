import { beforeEach, describe, expect, it, vi } from "vitest";
const { guard, rpc } = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/utils/authenticated-mutation-route", () => ({
  enforceAuthenticatedMutationRequest: guard,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
import { POST } from "./route";
const claimId = "10000000-0000-4000-8000-000000000001";
const request = (body: unknown) =>
  new Request("https://verifymzansi.com/api/trials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
describe("member trial actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guard.mockResolvedValue({ success: true, user: { id: "member-id" } });
    rpc.mockResolvedValue({ error: null });
  });
  it("does not mutate without an authenticated mutation guard", async () => {
    guard.mockResolvedValue({ success: false, response: new Response(null, { status: 401 }) });
    expect((await POST(request({ claimId, action: "renew" }))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("binds ownership to the authenticated member", async () => {
    expect((await POST(request({ claimId, action: "renew", userId: "someone-else" }))).status).toBe(
      200
    );
    expect(rpc).toHaveBeenCalledWith("update_own_intro_trial", {
      p_user_id: "member-id",
      p_claim_id: claimId,
      p_action: "renew",
    });
  });
  it("rejects resetting an introductory entitlement", async () => {
    expect((await POST(request({ claimId, action: "reset" }))).status).toBeGreaterThanOrEqual(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
