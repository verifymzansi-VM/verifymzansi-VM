import { beforeEach, describe, expect, it, vi } from "vitest";
const { guard, rpc } = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/utils/admin-route-guard", () => ({ enforceAdminMutationGuard: guard }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
import { POST } from "./route";
const request = (body: unknown) =>
  new Request("https://verifymzansi.com/api/admin/trials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const configuration = {
  action: "configure",
  target: "MZANSI_MARKET",
  reason: "Launch allocation",
  values: { slotLimit: 50, launchEnabled: true, sevenDayEnabled: true },
};
describe("trial management API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guard.mockResolvedValue({ success: true, user: { id: "staff-id" } });
    rpc.mockResolvedValue({ error: null });
  });
  it("requires the separately verified trial management capability", async () => {
    guard.mockResolvedValue({ success: false, response: new Response(null, { status: 403 }) });
    expect((await POST(request(configuration))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
    expect(guard).toHaveBeenCalledWith(expect.objectContaining({ capability: "trials:manage" }));
  });
  it("rejects oversized pools before any mutation", async () => {
    expect(
      (
        await POST(
          request({ ...configuration, values: { ...configuration.values, slotLimit: 5000 } })
        )
      ).status
    ).toBeGreaterThanOrEqual(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("takes the actor from the verified session, ignoring payload impersonation", async () => {
    expect((await POST(request({ ...configuration, actorId: "attacker" }))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "manage_intro_trial",
      expect.objectContaining({ p_actor_id: "staff-id", p_reason: "Launch allocation" })
    );
  });
  it("returns a safe conflict without exposing SQL errors", async () => {
    rpc.mockResolvedValue({ error: { code: "P0001", message: "internal secret detail" } });
    const response = await POST(request(configuration));
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("internal secret");
  });
});
