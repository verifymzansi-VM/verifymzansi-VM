import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedBrowse } from "../feed/browse";
import type { FeedRef } from "../feed/types";
import { presentBusinessSlide, presentEventSlide, presentListingSlide } from "../feed/presenters";
import {
  foundationBrowseSequence,
  foundationDirectSequence,
  foundationFeedSlides,
} from "./feed-read";
import { restoredPublicRow } from "./marketplace-read";
import { restoredPublicDetailWithoutTotals } from "./marketplace-server";
import { searchFoundationPostIds } from "./post-search";
import type * as MarketplaceRead from "./marketplace-read";
import type * as PostSearch from "./post-search";

vi.mock("./server-public", () => ({ foundationServerPublicApi: vi.fn(() => publicApi) }));
vi.mock("./marketplace-server", () => ({
  restoredPublicDetailWithoutTotals: vi.fn(),
  restoredPostEngagement: vi.fn(async () => new Map()),
}));
// The real filter translation, so each browse is checked down to the request.
vi.mock("./marketplace-read", async (importOriginal) => ({
  ...(await importOriginal<typeof MarketplaceRead>()),
  restoredPublicRow: vi.fn(),
}));
vi.mock("./post-search", async (importOriginal) => ({
  ...(await importOriginal<typeof PostSearch>()),
  searchFoundationPostIds: vi.fn(),
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
const ids = (start: number, count: number) =>
  Array.from({ length: count }, (_, n) => uuid(start + n));
/** The search requests the browse made, one per collection. */
const requests = () =>
  vi.mocked(searchFoundationPostIds).mock.calls.map((call) => call[1] as Record<string, unknown>);

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
    vi.mocked(restoredPublicDetailWithoutTotals).mockResolvedValueOnce(detail(post) as never);
    const slides = await foundationFeedSlides([ref]);
    expect(slides.get(`${kind}:${ref.id}`)).toEqual({ slide });
  });

  it.each([
    ["l", { kind: "business", area: "business" }],
    ["b", { kind: "listing", area: "market" }],
    ["p", { kind: "business", area: "tourism_events" }],
    ["t", { kind: "business", area: "business" }],
  ] as const)("gives no slide when a %s ref resolves to a %o", async (kind, post) => {
    vi.mocked(restoredPublicDetailWithoutTotals).mockResolvedValueOnce(detail(post) as never);
    const slides = await foundationFeedSlides([{ kind, id: uuid(2) }]);
    expect(slides.get(`${kind}:${uuid(2)}`)).toBeNull();
    expect(presentListingSlide).not.toHaveBeenCalled();
    expect(presentBusinessSlide).not.toHaveBeenCalled();
    expect(presentEventSlide).not.toHaveBeenCalled();
  });

  it("gives no slide for a post that is no longer public", async () => {
    vi.mocked(restoredPublicDetailWithoutTotals).mockResolvedValueOnce(null);
    const slides = await foundationFeedSlides([{ kind: "l", id: uuid(3) }]);
    expect([...slides]).toEqual([[`l:${uuid(3)}`, null]]);
  });

  it.each([
    [["call"], true],
    [["whatsapp", "form"], true],
    [["form"], false],
    [[], false],
  ])("derives the public owner summary from channels %o", async (channels, hasPhone) => {
    vi.mocked(restoredPublicDetailWithoutTotals).mockResolvedValueOnce(
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
    vi.mocked(restoredPublicDetailWithoutTotals).mockResolvedValueOnce(
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
    [browse({ vertical: "market" }), [{ area: "market" }]],
    [browse({ vertical: "business" }), [{ area: "business" }]],
    [
      browse({ vertical: "tourism" }),
      [
        { area: "tourism_events", category: "tourism_hospitality" },
        { area: "tourism_events", category: "events" },
      ],
    ],
    [browse({ vertical: "tourism", kind: "events" }), [{ category: "events" }]],
    [browse({ vertical: "tourism", eventType: "music" }), [{ category: "events" }]],
    [browse({ vertical: "tourism", kind: "stays" }), [{ category: "tourism_hospitality" }]],
    [
      browse({ vertical: "tourism", category: "guest_house" }),
      [{ category: "tourism_hospitality", activity: "guest_house" }],
    ],
  ])("reads each section of %o in one ids-only call", async (input, sections) => {
    vi.mocked(searchFoundationPostIds).mockResolvedValue({ ids: [], total: 0 });
    await foundationBrowseSequence(input);
    expect(searchFoundationPostIds).toHaveBeenCalledTimes(sections.length);
    expect(vi.mocked(searchFoundationPostIds).mock.calls[0]![0]).toBe(publicApi);
    requests().forEach((request, index) => {
      expect(request).toMatchObject({ ...sections[index], offset: 0, limit: 200 });
    });
  });

  it("translates the market filters into the database request", async () => {
    vi.mocked(searchFoundationPostIds).mockResolvedValue({ ids: [], total: 0 });
    await foundationBrowseSequence(
      browse({
        province: "Gauteng",
        query: "bakkie",
        condition: "good",
        category: "vehicles",
        sort: "price_asc",
      })
    );
    expect(requests()).toEqual([
      {
        area: "market",
        category: "vehicles",
        q: "bakkie",
        sort: "price_asc",
        province: "gp",
        condition: "good",
        offset: 0,
        limit: 200,
      },
    ]);
  });

  it("finds tourism businesses in a business text search, in one call", async () => {
    vi.mocked(searchFoundationPostIds).mockResolvedValue({ ids: [], total: 0 });
    await foundationBrowseSequence(browse({ vertical: "business", query: "lodge" }));
    expect(requests()).toEqual([
      { kind: "business", q: "lodge", sort: "relevance", offset: 0, limit: 200 },
    ]);
  });

  it("refuses an unknown filter before reading", async () => {
    await expect(foundationBrowseSequence(browse({ category: "not_a_category" }))).rejects.toThrow(
      "Invalid category"
    );
    expect(searchFoundationPostIds).not.toHaveBeenCalled();
  });

  it("keeps every ref when the total fits", async () => {
    vi.mocked(searchFoundationPostIds).mockResolvedValue({ ids: ids(0, 120), total: 120 });
    const result = await foundationBrowseSequence(browse());
    expect(result.refs).toHaveLength(120);
    expect(result.refs[0]).toEqual({ kind: "l", id: uuid(0) });
    expect(result.exhausted).toBe(true);
  });

  it("reports more posts remain past the first 200", async () => {
    vi.mocked(searchFoundationPostIds).mockResolvedValue({ ids: ids(0, 200), total: 5000 });
    const result = await foundationBrowseSequence(browse());
    expect(searchFoundationPostIds).toHaveBeenCalledTimes(1);
    expect(result.refs).toHaveLength(200);
    expect(result.exhausted).toBe(false);
  });

  it("interleaves businesses and events and keeps at most 200 refs", async () => {
    vi.mocked(searchFoundationPostIds).mockImplementation(async (_api, input) => {
      const base = (input as { category?: string }).category === "events" ? 2000 : 1000;
      return { ids: ids(base, 150), total: 150 };
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
    vi.mocked(restoredPublicDetailWithoutTotals).mockResolvedValueOnce(detail(post) as never);
    await expect(foundationDirectSequence({ kind, id: uuid(6) })).resolves.toBeNull();
    expect(searchFoundationPostIds).not.toHaveBeenCalled();
  });

  it("returns null for a post that is not public", async () => {
    vi.mocked(restoredPublicDetailWithoutTotals).mockResolvedValueOnce(null);
    await expect(foundationDirectSequence({ kind: "l", id: uuid(7) })).resolves.toBeNull();
  });

  it.each([
    [{ kind: "listing", area: "market" }, "l", ["market"]],
    [{ kind: "business", area: "business" }, "b", ["business"]],
    [{ kind: "event", area: "tourism_events" }, "t", ["tourism_events", "tourism_events"]],
  ] as const)("continues a %o in its own section", async (post, kind, areas) => {
    vi.mocked(restoredPublicDetailWithoutTotals).mockResolvedValueOnce(detail(post) as never);
    vi.mocked(searchFoundationPostIds).mockResolvedValue({ ids: [], total: 0 });
    await foundationDirectSequence({ kind, id: uuid(8) });
    expect(requests().map((request) => request.area)).toEqual(areas);
    // Recommended is the database's own order (no sort sent).
    expect(requests()[0]!.sort).toBeUndefined();
  });

  it("leaves out the opened post and keeps at most 120 others", async () => {
    const opened = uuid(5);
    vi.mocked(restoredPublicDetailWithoutTotals).mockResolvedValueOnce(
      detail({ kind: "listing", area: "market" }) as never
    );
    vi.mocked(searchFoundationPostIds).mockResolvedValue({ ids: ids(0, 180), total: 180 });
    const result = await foundationDirectSequence({ kind: "l", id: opened });
    expect(result!.refs).toHaveLength(120);
    expect(result!.refs.some((ref) => ref.id === opened)).toBe(false);
    expect(result!.exhausted).toBe(false);
  });

  it("is exhausted when every other post fits", async () => {
    const opened = uuid(1);
    vi.mocked(restoredPublicDetailWithoutTotals).mockResolvedValueOnce(
      detail({ kind: "listing", area: "market" }) as never
    );
    vi.mocked(searchFoundationPostIds).mockResolvedValueOnce({ ids: ids(0, 3), total: 3 });
    await expect(foundationDirectSequence({ kind: "l", id: opened })).resolves.toEqual({
      refs: [
        { kind: "l", id: uuid(0) },
        { kind: "l", id: uuid(2) },
      ],
      exhausted: true,
    });
  });
});
