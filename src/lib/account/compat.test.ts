import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyOwnerFilter,
  getOwnerColumn,
  normalizeOwnerRecord,
  normalizeOwnerRecords,
  readOwnerId,
  resetOwnerColumnCacheForTesting,
  withOwnerColumn,
  withOwnerField,
} from "./compat";

function createProbeClient(
  results: Record<string, { error: { code?: string; message?: string } | null }>
) {
  const from = vi.fn(() => ({
    select: vi.fn((fields: string) => ({
      limit: vi.fn().mockResolvedValue(results[fields] ?? { error: null }),
    })),
  }));

  return { from };
}

describe("account compat helpers", () => {
  beforeEach(() => {
    resetOwnerColumnCacheForTesting();
  });

  it("detects owner_id columns when available", async () => {
    const client = createProbeClient({
      "id, owner_id": { error: null },
    });

    await expect(getOwnerColumn(client as never, "listings")).resolves.toBe("owner_id");
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("falls back to seller_id when owner_id is unavailable", async () => {
    const client = createProbeClient({
      "id, owner_id": {
        error: { code: "42703", message: "column listings.owner_id does not exist" },
      },
      "id, seller_id": { error: null },
    });

    await expect(getOwnerColumn(client as never, "listings")).resolves.toBe("seller_id");
    expect(client.from).toHaveBeenCalledTimes(2);
  });

  it("caches detected owner columns per table", async () => {
    const client = createProbeClient({
      "id, owner_id": { error: null },
    });

    await expect(getOwnerColumn(client as never, "promotions")).resolves.toBe("owner_id");
    await expect(getOwnerColumn(client as never, "promotions")).resolves.toBe("owner_id");
    expect(client.from).toHaveBeenCalledTimes(1);
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

  it("rewrites owner-aware selects, filters, and payloads", () => {
    const eq = vi.fn().mockReturnValue("filtered");

    expect(withOwnerColumn("id, owner_id, title", "seller_id")).toBe("id, seller_id, title");
    expect(applyOwnerFilter({ eq } as never, "seller_id", "user-1")).toBe("filtered");
    expect(eq).toHaveBeenCalledWith("seller_id", "user-1");
    expect(withOwnerField({ title: "Test" }, "seller_id", "user-1")).toEqual({
      title: "Test",
      seller_id: "user-1",
    });
  });
});
