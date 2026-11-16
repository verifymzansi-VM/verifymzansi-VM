import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as HiddenFeatures from "@/lib/hidden-features";
// The route is hidden until it works (src/lib/hidden-features.ts); these
// tests switch it on to keep the code behind the switch checked.
const hiddenFeature = vi.hoisted(() => ({ shown: true }));
vi.mock("@/lib/hidden-features", async (importOriginal) => ({
  ...(await importOriginal<typeof HiddenFeatures>()),
  get SHOW_TRIAL_PLAN_CHANGES() {
    return hiddenFeature.shown;
  },
}));
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
describe("member trial actions while hidden", () => {
  it("answers 404 before any other check", async () => {
    hiddenFeature.shown = false;
    try {
      const res = await POST(
        new Request("https://verifymzansi.com/api/trials", { method: "POST", body: "{}" })
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Not found" });
    } finally {
      hiddenFeature.shown = true;
    }
  });
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
