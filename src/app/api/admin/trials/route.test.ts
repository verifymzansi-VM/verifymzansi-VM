import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as HiddenFeatures from "@/lib/hidden-features";
// The route is hidden until it works (src/lib/hidden-features.ts); these
// tests switch it on to keep the code behind the switch checked.
const hiddenFeature = vi.hoisted(() => ({ shown: true }));
vi.mock("@/lib/hidden-features", async (importOriginal) => ({
  ...(await importOriginal<typeof HiddenFeatures>()),
  get SHOW_STAFF_TRIALS() {
    return hiddenFeature.shown;
  },
}));
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
describe("trial management API while hidden", () => {
  it("answers 404 before any other check", async () => {
    hiddenFeature.shown = false;
    try {
      const res = await POST(
        new Request("https://verifymzansi.com/api/admin/trials", { method: "POST", body: "{}" })
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Not found" });
    } finally {
      hiddenFeature.shown = true;
    }
  });
});

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
  it("sets the account balance using the verified actor", async () => {
    const target = "e416d52a-55ea-490b-b6c9-f8c5055305fa";
    expect(
      (
        await POST(
          request({
            action: "set_account_free_posts",
            target,
            reason: "Support allowance",
            values: { remaining: 3 },
          })
        )
      ).status
    ).toBe(200);
    expect(rpc).toHaveBeenCalledWith("set_account_free_posts", {
      p_actor_id: "staff-id",
      p_user_id: target,
      p_remaining: 3,
      p_reason: "Support allowance",
    });
  });
  it.each([-1, 1.5, 10001, "3", null])(
    "rejects invalid free-post balance %s",
    async (remaining) => {
      const response = await POST(
        request({
          action: "set_account_free_posts",
          target: "e416d52a-55ea-490b-b6c9-f8c5055305fa",
          reason: "Support allowance",
          values: { remaining },
        })
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(rpc).not.toHaveBeenCalled();
    }
  );
});
