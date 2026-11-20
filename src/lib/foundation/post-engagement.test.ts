import { describe, expect, it, vi } from "vitest";
import {
  FoundationEngagementError,
  readFoundationPostEngagement,
  recordFoundationPostViews,
  setFoundationPostLike,
} from "./post-engagement";
import type { FoundationPublicApi } from "./public-api";
import type { FoundationServiceApi } from "./service-api";

const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const DEVICE = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const api = <T>(rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as unknown as T;

describe("readFoundationPostEngagement", () => {
  it("reads totals in batches of 50 and keys them by post", async () => {
    const rpc = vi.fn(async (_name: string, args: { p_post_ids: string[] }) => ({
      data: {
        items: args.p_post_ids
          .filter((_, index) => index % 2 === 0)
          .map((post_id) => ({ post_id, views: 3, likes: 1 })),
      },
      error: null,
    }));
    const ids = Array.from({ length: 150 }, (_, n) => id(n));
    const totals = await readFoundationPostEngagement(api<FoundationPublicApi>(rpc), [
      ...ids,
      ids[0]!,
    ]);
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls[0]![1].p_post_ids).toHaveLength(50);
    expect(rpc.mock.calls[0]![0]).toBe("get_post_engagement");
    expect(totals.get(id(0))).toEqual({ views: 3, likes: 1 });
    expect(totals.has(id(1))).toBe(false);
    expect(totals.size).toBe(75);
  });

  it("rejects totals for a post it did not ask for, or a malformed answer", async () => {
    const stray = vi.fn(async () => ({
      data: { items: [{ post_id: id(9), views: 1, likes: 0 }] },
      error: null,
    }));
    await expect(
      readFoundationPostEngagement(api<FoundationPublicApi>(stray), [id(1)])
    ).rejects.toThrow("Invalid post engagement response");
    const negative = vi.fn(async () => ({
      data: { items: [{ post_id: id(1), views: -1, likes: 0 }] },
      error: null,
    }));
    await expect(
      readFoundationPostEngagement(api<FoundationPublicApi>(negative), [id(1)])
    ).rejects.toThrow();
    const failed = vi.fn(async () => ({ data: null, error: { code: "57014" } }));
    await expect(
      readFoundationPostEngagement(api<FoundationPublicApi>(failed), [id(1)])
    ).rejects.toThrow("could not be loaded");
  });

  it("asks nothing for no posts", async () => {
    const rpc = vi.fn();
    expect((await readFoundationPostEngagement(api<FoundationPublicApi>(rpc), [])).size).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("the service commands", () => {
  it("record views: distinct posts, no account when signed out", async () => {
    const rpc = vi.fn(async () => ({ data: { counted: [id(1)] }, error: null }));
    const counted = await recordFoundationPostViews(api<FoundationServiceApi>(rpc), {
      postIds: [id(1), id(1), id(2)],
      device: DEVICE,
      account: null,
    });
    expect(counted).toEqual([id(1)]);
    expect(rpc).toHaveBeenCalledWith("record_post_views", {
      p_post_ids: [id(1), id(2)],
      p_device: DEVICE,
    });
  });

  it("set a like and map the refusals", async () => {
    const rpc = vi.fn(async () => ({
      data: { liked: false, likes: 0, counted: false },
      error: null,
    }));
    expect(
      await setFoundationPostLike(api<FoundationServiceApi>(rpc), {
        postId: id(1),
        device: DEVICE,
        account: id(5),
        liked: false,
      })
    ).toEqual({ liked: false, likes: 0, counted: false });
    expect(rpc).toHaveBeenCalledWith("set_post_like", {
      p_post_id: id(1),
      p_device: DEVICE,
      p_account: id(5),
      p_liked: false,
    });
    for (const [code, reason] of [
      ["PT404", "unavailable"],
      ["22023", "invalid"],
    ] as const) {
      const refused = vi.fn(async () => ({ data: null, error: { code } }));
      const error = await setFoundationPostLike(api<FoundationServiceApi>(refused), {
        postId: id(1),
        device: DEVICE,
        account: null,
        liked: null,
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(FoundationEngagementError);
      expect((error as FoundationEngagementError).reason).toBe(reason);
    }
  });
});
