import { beforeEach, describe, expect, it, vi } from "vitest";

// src/test/setup.ts replaces two exports globally; test the real module here.
vi.unmock("@/lib/services/queue-claims");

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

import { checkQueueClaim, claimNextItems, releaseDecidedClaim } from "./queue-claims";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const ITEM = { type: "report" as const, id: "22222222-2222-4222-8222-222222222222" };

describe("queue claims", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lets the holder decide", async () => {
    rpc.mockResolvedValue({ data: { ok: true, claimed: true }, error: null });
    await expect(checkQueueClaim(ACTOR, ITEM)).resolves.toBeNull();
    expect(rpc).toHaveBeenCalledWith("check_queue_claim", {
      p_actor: ACTOR,
      p_item_type: "report",
      p_item_id: ITEM.id,
    });
  });

  it.each([
    ["claim_required", 409],
    ["claimed_by_other", 409],
    ["not_independent", 403],
  ])("refuses %s with %i", async (error, status) => {
    rpc.mockResolvedValue({ data: { ok: false, error }, error: null });
    const res = await checkQueueClaim(ACTOR, ITEM);
    expect(res?.status).toBe(status);
    await expect(res?.json()).resolves.toMatchObject({ code: error });
  });

  it("fails closed when the check itself fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    expect((await checkQueueClaim(ACTOR, ITEM))?.status).toBe(503);
  });

  it("maps a governor's claim attempt to forbidden", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "claim_forbidden" } });
    await expect(claimNextItems(ACTOR, "reports", 10)).resolves.toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("never fails a decision because the release failed", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    await expect(releaseDecidedClaim(ACTOR, ITEM)).resolves.toBeUndefined();
  });
});
