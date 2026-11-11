import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import {
  foundationPostEditPath,
  foundationPostPath,
  listFoundationOwnerPosts,
} from "./owner-posts";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rpc = vi.fn();
const api = { rpc } as unknown as FoundationAuthenticatedApi;
const post = (overrides: Record<string, unknown> = {}) => ({
  id: uuid(1),
  kind: "listing",
  area: "market",
  category: "vehicles",
  title: "Toyota Corolla",
  status: "live",
  revision: 2,
  created_at: "2026-11-01T08:00:00Z",
  published_at: "2026-11-02T08:00:00Z",
  visible_until: null,
  price_mode: "amount",
  price_cents: "15000000",
  cover_object_key: `media/${uuid(2)}`,
  ...overrides,
});
const page = (overrides: Record<string, unknown> = {}) => ({
  items: [post()],
  total: 1,
  limit: 48,
  offset: 0,
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe("listFoundationOwnerPosts", () => {
  it("reads the first 48 of the caller's posts by default", async () => {
    rpc.mockResolvedValueOnce({ data: page(), error: null });
    await expect(listFoundationOwnerPosts(api)).resolves.toEqual(page());
    expect(rpc).toHaveBeenCalledExactlyOnceWith("list_my_posts", { p_limit: 48, p_offset: 0 });
  });

  it("passes the requested page window", async () => {
    rpc.mockResolvedValueOnce({ data: page({ limit: 10, offset: 20, items: [] }), error: null });
    await listFoundationOwnerPosts(api, 10, 20);
    expect(rpc).toHaveBeenCalledWith("list_my_posts", { p_limit: 10, p_offset: 20 });
  });

  it("fails closed on a database error", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    await expect(listFoundationOwnerPosts(api)).rejects.toThrow("Your posts could not be loaded");
  });

  it.each([
    ["an unknown status", page({ items: [post({ status: "hidden" })] })],
    ["a numeric price", page({ items: [post({ price_cents: 1500 })] })],
    ["a negative price", page({ items: [post({ price_cents: "-1" })] })],
    ["a cover outside the media namespace", page({ items: [post({ cover_object_key: "x/y" })] })],
    ["an owner id on a post", page({ items: [post({ owner_id: uuid(3) })] })],
    ["a page limit above 100", page({ limit: 101 })],
    ["more than 100 posts", page({ items: Array(101).fill(post()), total: 101 })],
  ])("refuses %s", async (_label, data) => {
    rpc.mockResolvedValueOnce({ data, error: null });
    await expect(listFoundationOwnerPosts(api)).rejects.toThrow();
  });
});

describe("post paths", () => {
  const id = uuid(5);
  it.each([
    ["listing", "market", `/listing/${id}`, `/post/edit-listing/${id}`],
    ["business", "business", `/mzansi-business/${id}`, `/post/edit-business/${id}`],
    ["business", "tourism_events", `/tourism-events/${id}`, `/post/edit-tourism/${id}`],
    ["event", "tourism_events", `/tourism-events/${id}`, `/post/edit-tourism/${id}`],
  ] as const)("routes a %s in %s to its public and edit pages", (kind, area, view, edit) => {
    expect(foundationPostPath({ id, kind, area })).toBe(view);
    expect(foundationPostEditPath({ id, kind, area })).toBe(edit);
  });
});
