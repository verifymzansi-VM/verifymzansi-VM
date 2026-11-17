import { describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_PROFILE_TABLE,
  ACCOUNT_PROFILE_WRITE_TABLE,
  applyOwnerFilter,
  getOwnerColumn,
  normalizeOwnerRecord,
  normalizeOwnerRecords,
  readOwnerId,
} from "./compat";

describe("account compat helpers", () => {
  it("uses owner_id without probing the database", async () => {
    const client = { from: vi.fn() };
    await expect(getOwnerColumn(client as never, "listings")).resolves.toBe("owner_id");
    expect(client.from).not.toHaveBeenCalled();
  });

  it("pins account profile table constants to account_profiles", () => {
    expect(ACCOUNT_PROFILE_TABLE).toBe("account_profiles");
    expect(ACCOUNT_PROFILE_WRITE_TABLE).toBe("account_profiles");
  });

  it("normalizes seller_id records back to owner_id", () => {
    expect(readOwnerId({ seller_id: "seller-1" })).toBe("seller-1");
    expect(normalizeOwnerRecord({ id: "listing-1", seller_id: "seller-1" })).toMatchObject({
      id: "listing-1",
      owner_id: "seller-1",
      seller_id: "seller-1",
    });
    expect(
      normalizeOwnerRecords([
        { id: "a", seller_id: "seller-a" },
        { id: "b", owner_id: "owner-b" },
      ])
    ).toEqual([
      { id: "a", seller_id: "seller-a", owner_id: "seller-a" },
      { id: "b", owner_id: "owner-b" },
    ]);
  });

  it("applies owner filters", () => {
    const eq = vi.fn().mockReturnValue("filtered");
    expect(applyOwnerFilter({ eq } as never, "owner_id", "user-1")).toBe("filtered");
    expect(eq).toHaveBeenCalledWith("owner_id", "user-1");
  });
});
