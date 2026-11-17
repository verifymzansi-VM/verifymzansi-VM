import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedBrowse } from "../feed/browse";
import type { FeedRef } from "../feed/types";
import { presentBusinessSlide, presentEventSlide, presentListingSlide } from "../feed/presenters";
import {
  foundationBrowseSequence,
  foundationDirectSequence,
  foundationFeedSlides,
} from "./feed-read";
import { readRestoredCollection, restoredPublicRow } from "./marketplace-read";
import { restoredPublicDetail } from "./marketplace-server";

vi.mock("./server-public", () => ({ foundationServerPublicApi: vi.fn(() => publicApi) }));
vi.mock("./marketplace-server", () => ({ restoredPublicDetail: vi.fn() }));
vi.mock("./marketplace-read", () => ({
  readRestoredCollection: vi.fn(),
  restoredPublicRow: vi.fn(),
}));
vi.mock("../feed/presenters", () => ({
  presentListingSlide: vi.fn(() => ({ slide: "listing" })),
  presentBusinessSlide: vi.fn(() => ({ slide: "business" })),
  presentEventSlide: vi.fn(() => ({ slide: "event" })),
}));

const publicApi = { marker: "public" };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type Post = {
  kind: "listing" | "business" | "event";
  area: "market" | "business" | "tourism_events";
};
const detail = ({ kind, area }: Post, overrides: Record<string, unknown> = {}) => ({
  kind,
  area,
  seller: { public_name: "Sipho", identity_verified: true },
  contact_channels: ["form"],
  ...overrides,
});
const browse = (overrides: Partial<FeedBrowse> = {}): FeedBrowse => ({
  vertical: "market",
  province: null,
  category: null,
  condition: null,
  kind: "all",
  eventType: null,
  sort: "recommended",
  query: null,
  ...overrides,
});
const rows = (start: number, count: number) =>
  Array.from({ length: count }, (_, n) => ({ id: uuid(start + n) }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(restoredPublicRow).mockImplementation(
    (post) => ({ id: (post as { id?: string }).id, owner_id: "never", category_key: "x" }) as never
  );
  vi.mocked(presentListingSlide).mockReturnValue({ slide: "listing" } as never);
  vi.mocked(presentBusinessSlide).mockReturnValue({ slide: "business" } as never);
  vi.mocked(presentEventSlide).mockReturnValue({ slide: "event" } as never);
});

describe("foundationFeedSlides", () => {
  it.each([
    ["l", { kind: "listing", area: "market" }, "listing"],
    ["b", { kind: "business", area: "business" }, "business"],
    ["p", { kind: "event", area: "tourism_events" }, "event"],
    ["t", { kind: "business", area: "tourism_events" }, "business"],
    ["t", { kind: "event", area: "tourism_events" }, "event"],
  ] as const)("presents a %s ref that resolves to a %o", async (kind, post, slide) => {
    const ref: FeedRef = { kind, id: uuid(1) };
    vi.mocked(restoredPublicDetail).mockResolvedValueOnce(detail(post) as never);
    const slides = await foundationFeedSlides([ref]);
    expect(slides.get(`${kind}:${ref.id}`)).toEqual({ slide });
  });

  it.each([
    ["l", { kind: "business", area: "business" }],
    ["b", { kind: "listing", area: "market" }],
    ["p", { kind: "business", area: "tourism_events" }],
    ["t", { kind: "business", area: "business" }],
  ] as const)("gives no slide when a %s ref resolves to a %o", async (kind, post) => {
    vi.mocked(restoredPublicDetail).mockResolvedValueOnce(detail(post) as never);
    const slides = await foundationFeedSlides([{ kind, id: uuid(2) }]);
    expect(slides.get(`${kind}:${uuid(2)}`)).toBeNull();
    expect(presentListingSlide).not.toHaveBeenCalled();
    expect(presentBusinessSlide).not.toHaveBeenCalled();
    expect(presentEventSlide).not.toHaveBeenCalled();
  });

  it("gives no slide for a post that is no longer public", async () => {
    vi.mocked(restoredPublicDetail).mockResolvedValueOnce(null);
    const slides = await foundationFeedSlides([{ kind: "l", id: uuid(3) }]);
    expect([...slides]).toEqual([[`l:${uuid(3)}`, null]]);
  });

  it.each([
    [["call"], true],
    [["whatsapp", "form"], true],
    [["form"], false],
    [[], false],
  ])("derives the public owner summary from channels %o", async (channels, hasPhone) => {
    vi.mocked(restoredPublicDetail).mockResolvedValueOnce(
      detail(
        { kind: "listing", area: "market" },
        { contact_channels: channels, seller: { public_name: "Lerato", identity_verified: false } }
      ) as never
    );
    await foundationFeedSlides([{ kind: "l", id: uuid(4) }]);
    const [row, owner, engagement] = vi.mocked(presentListingSlide).mock.calls[0]!;
    expect(owner).toEqual({
      display_name: "Lerato",
      account_verification_status: null,
      has_phone: hasPhone,
    });
    // Public cards never carry an owner id, private category key or real counts.
    expect(row).toMatchObject({ owner_id: "", category_key: null });
    expect(engagement).toEqual({ views: 0, likes: 0, viewerHasLiked: false });
  });

  it("marks a verified seller as verified", async () => {
    vi.mocked(restoredPublicDetail).mockResolvedValueOnce(
      detail({ kind: "business", area: "business" }) as never
    );
    await foundationFeedSlides([{ kind: "b", id: uuid(5) }]);
    expect(vi.mocked(presentBusinessSlide).mock.calls[0]![1]).toMatchObject({
      account_verification_status: "verified",
    });
  });
});

describe("foundationBrowseSequence", () => {
  it.each([
    [browse({ vertical: "market" }), ["listings"]],
    [browse({ vertical: "business" }), ["businesses"]],
    [browse({ vertical: "tourism" }), ["businesses", "promotions"]],
    [browse({ vertical: "tourism", kind: "events" }), ["promotions"]],
    [browse({ vertical: "tourism", eventType: "music" }), ["promotions"]],
    [browse({ vertical: "tourism", kind: "stays" }), ["businesses"]],
    [browse({ vertical: "tourism", category: "guest_house" }), ["businesses"]],
  ])("reads the collections for %o", async (input, collections) => {
    vi.mocked(readRestoredCollection).mockResolvedValue({ rows: [], total: 0 } as never);
    await foundationBrowseSequence(input);
    expect(vi.mocked(readRestoredCollection).mock.calls.map((call) => call[1])).toEqual(
      collections
    );
    expect(vi.mocked(readRestoredCollection).mock.calls[0]![0]).toBe(publicApi);
  });

  it("translates the market filters into public query parameters", async () => {
    vi.mocked(readRestoredCollection).mockResolvedValue({ rows: [], total: 0 } as never);
    await foundationBrowseSequence(
      browse({
        province: "gauteng",
        query: "bakkie",
        condition: "used",
        category: "vehicles",
        sort: "newest",
      })
    );
    const params = vi.mocked(readRestoredCollection).mock.calls[0]![2]!;
    expect(Object.fromEntries(params)).toEqual({
      limit: "50",
      sort: "newest",
      province: "gauteng",
      q: "bakkie",
      condition: "used",
      category: "vehicles",
      page: "1",
    });
  });

  it("reads tourism stays as tourism businesses with the stay type as subcategory", async () => {
    vi.mocked(readRestoredCollection).mockResolvedValue({ rows: [], total: 0 } as never);
    await foundationBrowseSequence(browse({ vertical: "tourism", category: "guest_house" }));
    const params = vi.mocked(readRestoredCollection).mock.calls[0]![2]!;
    expect(params.get("category")).toBe("tourism_hospitality");
    expect(params.get("subcategory")).toBe("guest_house");
  });

  it("passes the event type to the events collection", async () => {
    vi.mocked(readRestoredCollection).mockResolvedValue({ rows: [], total: 0 } as never);
    await foundationBrowseSequence(browse({ vertical: "tourism", eventType: "music" }));
    const params = vi.mocked(readRestoredCollection).mock.calls[0]![2]!;
    expect(params.get("event_type")).toBe("music");
    expect(params.has("category")).toBe(false);
  });

  it("reads pages until the total is covered", async () => {
    // The same parameters object is reused, so record each page as it is asked for.
    const pages: string[] = [];
    vi.mocked(readRestoredCollection).mockImplementation(async (_api, _collection, params) => {
      const page = Number(params!.get("page"));
      pages.push(String(page));
      return { rows: rows((page - 1) * 50, page === 3 ? 20 : 50), total: 120 } as never;
    });
    const result = await foundationBrowseSequence(browse());
    expect(pages).toEqual(["1", "2", "3"]);
    expect(result.refs).toHaveLength(120);
    expect(result.refs[0]).toEqual({ kind: "l", id: uuid(0) });
    expect(result.exhausted).toBe(true);
  });

  it("stops after four pages and reports more posts remain", async () => {
    let page = 0;
    vi.mocked(readRestoredCollection).mockImplementation(
      async () => ({ rows: rows(50 * page++, 50), total: 5000 }) as never
    );
    const result = await foundationBrowseSequence(browse());
    expect(readRestoredCollection).toHaveBeenCalledTimes(4);
    expect(result.refs).toHaveLength(200);
    expect(result.exhausted).toBe(false);
  });

  it("interleaves businesses and events and keeps at most 200 refs", async () => {
    vi.mocked(readRestoredCollection).mockImplementation(async (_api, collection, params) => {
      const page = Number(params!.get("page"));
      const base = collection === "businesses" ? 1000 : 2000;
      return { rows: rows(base + (page - 1) * 50, 50), total: 150 } as never;
    });
    const result = await foundationBrowseSequence(browse({ vertical: "tourism" }));
    expect(result.refs.slice(0, 4)).toEqual([
      { kind: "b", id: uuid(1000) },
      { kind: "p", id: uuid(2000) },
      { kind: "b", id: uuid(1001) },
      { kind: "p", id: uuid(2001) },
    ]);
    expect(result.refs).toHaveLength(200);
    expect(result.exhausted).toBe(false);
  });
});

describe("foundationDirectSequence", () => {
  it.each([
    ["l", { kind: "business", area: "business" }],
    ["b", { kind: "listing", area: "market" }],
    ["p", { kind: "business", area: "tourism_events" }],
    ["t", { kind: "listing", area: "market" }],
  ] as const)("refuses a %s link that resolves to a %o", async (kind, post) => {
    vi.mocked(restoredPublicDetail).mockResolvedValueOnce(detail(post) as never);
    await expect(foundationDirectSequence({ kind, id: uuid(6) })).resolves.toBeNull();
    expect(readRestoredCollection).not.toHaveBeenCalled();
  });

  it("returns null for a post that is not public", async () => {
    vi.mocked(restoredPublicDetail).mockResolvedValueOnce(null);
    await expect(foundationDirectSequence({ kind: "l", id: uuid(7) })).resolves.toBeNull();
  });

  it.each([
    [{ kind: "listing", area: "market" }, "l", ["listings"]],
    [{ kind: "business", area: "business" }, "b", ["businesses"]],
    [{ kind: "event", area: "tourism_events" }, "t", ["businesses", "promotions"]],
  ] as const)("continues a %o in its own section", async (post, kind, collections) => {
    vi.mocked(restoredPublicDetail).mockResolvedValueOnce(detail(post) as never);
    vi.mocked(readRestoredCollection).mockResolvedValue({ rows: [], total: 0 } as never);
    await foundationDirectSequence({ kind, id: uuid(8) });
    expect(vi.mocked(readRestoredCollection).mock.calls.map((call) => call[1])).toEqual(
      collections
    );
    expect(vi.mocked(readRestoredCollection).mock.calls[0]![2]!.get("sort")).toBe("recommended");
  });

  it("leaves out the opened post and keeps at most 120 others", async () => {
    const opened = uuid(5);
    vi.mocked(restoredPublicDetail).mockResolvedValueOnce(
      detail({ kind: "listing", area: "market" }) as never
    );
    let page = 0;
    vi.mocked(readRestoredCollection).mockImplementation(
      async () => ({ rows: rows(50 * page++, 50), total: 180 }) as never
    );
    const result = await foundationDirectSequence({ kind: "l", id: opened });
    expect(result!.refs).toHaveLength(120);
    expect(result!.refs.some((ref) => ref.id === opened)).toBe(false);
    expect(result!.exhausted).toBe(false);
  });

  it("is exhausted when every other post fits", async () => {
    const opened = uuid(1);
    vi.mocked(restoredPublicDetail).mockResolvedValueOnce(
      detail({ kind: "listing", area: "market" }) as never
    );
    vi.mocked(readRestoredCollection).mockResolvedValueOnce({
      rows: rows(0, 3),
      total: 3,
    } as never);
    await expect(foundationDirectSequence({ kind: "l", id: opened })).resolves.toEqual({
      refs: [
        { kind: "l", id: uuid(0) },
        { kind: "l", id: uuid(2) },
      ],
      exhausted: true,
    });
  });
});
