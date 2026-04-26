import { describe, expect, it, vi } from "vitest";
import {
  claimFreePostSlot,
  getActiveFreePostUsage,
  releaseFreePostSlot,
  releaseRejectedDeletedFreePost,
} from "@/lib/billing/free-posts";

describe("free-post helpers", () => {
  it("returns used and remaining active free-post counts", async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockResolvedValue({ count: 1, error: null }),
            }),
          }),
        }),
      })),
    };

    await expect(
      getActiveFreePostUsage(client as never, "user-1", "MZANSI_MARKET", 2)
    ).resolves.toEqual({
      used: 1,
      remaining: 1,
      available: true,
    });
  });

  it("uses rpc claim when available", async () => {
    const admin = {
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    };

    await expect(
      claimFreePostSlot(admin as never, {
        userId: "user-1",
        area: "MZANSI_MARKET",
        contentId: "listing-1",
      })
    ).resolves.toBe(true);
    expect(admin.rpc).toHaveBeenCalledWith("claim_free_post_slot", {
      p_user_id: "user-1",
      p_area: "MZANSI_MARKET",
      p_content_id: "listing-1",
      p_max_allowed: 1,
    });
  });

  it("queries usage by user and area so each category remains separate", async () => {
    const calls: Array<{ column: string; value: unknown }> = [];
    const client = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn((column: string, value: unknown) => {
            calls.push({ column, value });
            return {
              eq: vi.fn((nestedColumn: string, nestedValue: unknown) => {
                calls.push({ column: nestedColumn, value: nestedValue });
                return {
                  is: vi.fn().mockResolvedValue({ count: 1, error: null }),
                };
              }),
            };
          }),
        }),
      })),
    };

    await expect(
      getActiveFreePostUsage(client as never, "user-1", "MZANSI_BUSINESS")
    ).resolves.toEqual({
      used: 1,
      remaining: 0,
      available: false,
    });

    expect(calls).toEqual([
      { column: "user_id", value: "user-1" },
      { column: "area", value: "MZANSI_BUSINESS" },
    ]);
  });

  it("falls back to insert and returns false on duplicate exhaustion", async () => {
    const insert = vi
      .fn()
      .mockResolvedValue({ error: { code: "23505", message: "duplicate key value" } });
    const admin = {
      from: vi.fn(() => ({
        insert,
      })),
    };

    await expect(
      claimFreePostSlot(admin as never, {
        userId: "user-1",
        area: "MZANSI_MARKET",
        contentId: "listing-1",
      })
    ).resolves.toBe(false);
  });

  it("releases claims by update when ledger columns are available", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "claim-1" }, error: null });
    const admin = {
      from: vi.fn(() => ({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    maybeSingle,
                  }),
                }),
              }),
            }),
          }),
        }),
      })),
    };

    await expect(
      releaseFreePostSlot(admin as never, {
        userId: "user-1",
        area: "MZANSI_MARKET",
        contentId: "listing-1",
        reason: "create_failed",
      })
    ).resolves.toBe(true);
    expect(maybeSingle).toHaveBeenCalled();
  });

  it("releases rejected deleted content with the expected reason", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "claim-1" }, error: null });
    const admin = {
      from: vi.fn(() => ({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    maybeSingle,
                  }),
                }),
              }),
            }),
          }),
        }),
      })),
    };

    await expect(
      releaseRejectedDeletedFreePost(admin as never, "user-1", "MZANSI_MARKET", "listing-1")
    ).resolves.toBe(true);
  });
});
