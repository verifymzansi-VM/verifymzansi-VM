import { beforeEach, describe, expect, it, vi } from "vitest";

// src/test/setup.ts replaces the reads globally; test the real module here.
vi.unmock("@/lib/services/queue-claims");

const { readFrontendStaffClaimViews, readMyFrontendStaffClaims } = vi.hoisted(() => ({
  readFrontendStaffClaimViews: vi.fn(),
  readMyFrontendStaffClaims: vi.fn(),
}));
vi.mock("@/lib/foundation/staff-claims-server", () => ({
  readFrontendStaffClaimViews,
  readMyFrontendStaffClaims,
}));

import { countMyClaims, getClaimsForItems, getMyClaimedItems } from "./queue-claims";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const ITEM = { type: "report" as const, id: "22222222-2222-4222-8222-222222222222" };

describe("queue claims", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readMyFrontendStaffClaims.mockResolvedValue({
      items: [
        { item_type: "report", id: "a", mine: true, queue: "reports" },
        { item_type: "verification_step", id: "b", mine: true, queue: "kyc" },
        { item_type: "report", id: "c", mine: false, queue: "reports" },
      ],
    });
  });

  it("reads no claims for an empty page", async () => {
    await expect(getClaimsForItems(ACTOR, [])).resolves.toEqual({});
    expect(readFrontendStaffClaimViews).not.toHaveBeenCalled();
  });

  it("reads claim views for the listed items", async () => {
    const views = { [`report:${ITEM.id}`]: { mine: true, holderName: "you", expiresAt: "x" } };
    readFrontendStaffClaimViews.mockResolvedValue(views);
    await expect(getClaimsForItems(ACTOR, [ITEM])).resolves.toBe(views);
    expect(readFrontendStaffClaimViews).toHaveBeenCalledExactlyOnceWith(ACTOR, [ITEM]);
  });

  it("lists and counts only the viewer's own claims in one queue", async () => {
    await expect(getMyClaimedItems(ACTOR, "reports")).resolves.toEqual([
      { type: "report", id: "a" },
    ]);
    await expect(countMyClaims(ACTOR, "kyc")).resolves.toBe(1);
    expect(readMyFrontendStaffClaims).toHaveBeenCalledWith(ACTOR);
  });
});
