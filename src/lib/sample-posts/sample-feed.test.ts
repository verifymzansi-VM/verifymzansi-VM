import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Catalogue from "./catalogue";
import type { SamplePostEntry } from "./catalogue";

const { mockSearch, mockHidden, approved } = vi.hoisted(() => ({
  mockSearch: vi.fn(),
  mockHidden: vi.fn(),
  approved: [] as SamplePostEntry[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/foundation/server-public", () => ({ foundationServerPublicApi: () => ({}) }));
vi.mock("@/lib/foundation/public-cards", () => ({
  searchFoundationCards: mockSearch,
  foundationMediaUrl: () => null,
}));
vi.mock("./hidden", () => ({ loadHiddenSampleSlugs: mockHidden }));
vi.mock("@/lib/utils/logger", () => ({ createLogger: () => ({ warn: vi.fn(), error: vi.fn() }) }));
vi.mock("./catalogue", async (importOriginal) => ({
  ...(await importOriginal<typeof Catalogue>()),
  APPROVED_SAMPLE_POSTS: approved,
}));

import { loadShowroomItems } from "@/lib/showroom/feed";
import { findSamplePost, listCatalogueSamples, listSamplePosts, resolveSamplePosts } from "./load";

const entry = (slug: string, area: SamplePostEntry["area"], category: string): SamplePostEntry => ({
  slug,
  area,
  category,
  title: `Sample ${slug}`,
  description: "A display-only example of how a post looks.",
  province: "KwaZulu-Natal",
  city: "Richards Bay",
  videoKey: `media/samples/${slug}.mp4`,
  posterKey: `media/samples/${slug}.webp`,
});

function foundationCard(id: string) {
  return {
    id,
    kind: "business",
    area: "business",
    title: `Real ${id}`,
    summary: "A real post",
    locality: "Durban",
    preview: { image_key: null, video_key: null },
    price_cents: null,
  };
}

describe("sample posts in the showrooms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    approved.splice(
      0,
      approved.length,
      entry("cakes", "business", "food_dining"),
      entry("lodge", "tourism", "lodge_game_lodge"),
      entry("bakkie", "market", "vehicles"),
      entry("expo", "event", "market_expo")
    );
    mockSearch.mockResolvedValue({ items: [foundationCard("r1"), foundationCard("r2")] });
    mockHidden.mockResolvedValue(new Set());
  });

  afterEach(() => vi.unstubAllEnvs());

  it("shows nothing while the switch is off, without reading the hide-list", async () => {
    const items = await loadShowroomItems("home");
    expect(items.map((item) => item.id)).toEqual(["r1", "r2"]);
    expect(await listSamplePosts()).toEqual([]);
    expect(await findSamplePost("cakes")).toBeNull();
    expect(mockHidden).not.toHaveBeenCalled();
  });

  it("puts samples after every real post, presented by VerifyMzansi", async () => {
    vi.stubEnv("SAMPLE_POSTS_ENABLED", "true");
    const items = await loadShowroomItems("home");
    expect(items.map((item) => item.id)).toEqual([
      "r1",
      "r2",
      "sample-cakes",
      "sample-lodge",
      "sample-bakkie",
      "sample-expo",
    ]);
    expect(items.slice(0, 2).every((item) => !item.sample)).toBe(true);
    expect(items.slice(2).every((item) => item.sample === true)).toBe(true);
    expect(items[2]).toMatchObject({
      href: "/sample/cakes",
      type: "business",
      mediaKind: "video",
      mediaUrl: "https://media.verifymzansi.com/media/samples/cakes.mp4",
      posterUrl: "https://media.verifymzansi.com/media/samples/cakes.webp",
      logoUrl: "/images/brand-shield-small.png",
    });
  });

  it.each([
    ["business", ["sample-cakes"]],
    ["market", ["sample-bakkie"]],
    ["tourism", ["sample-lodge", "sample-expo"]],
  ] as const)("matches samples to the %s showroom", async (surface, expected) => {
    vi.stubEnv("SAMPLE_POSTS_ENABLED", "true");
    const items = await loadShowroomItems(surface);
    expect(items.filter((item) => item.sample).map((item) => item.id)).toEqual(expected);
  });

  it("leaves out samples staff removed, everywhere", async () => {
    vi.stubEnv("SAMPLE_POSTS_ENABLED", "true");
    mockHidden.mockResolvedValue(new Set(["lodge", "bakkie"]));
    expect((await loadShowroomItems("home")).map((item) => item.id)).toEqual([
      "r1",
      "r2",
      "sample-cakes",
      "sample-expo",
    ]);
    expect(await findSamplePost("lodge")).toBeNull();
    expect((await findSamplePost("expo"))?.slug).toBe("expo");
    // Staff still see every catalogue sample, to restore it.
    expect((await listCatalogueSamples()).map((post) => post.slug)).toContain("lodge");
  });

  it("fails closed: no sample at all when the hide-list cannot be read", async () => {
    vi.stubEnv("SAMPLE_POSTS_ENABLED", "true");
    mockHidden.mockRejectedValue(new Error("unavailable"));
    expect((await loadShowroomItems("home")).map((item) => item.id)).toEqual(["r1", "r2"]);
    expect(await findSamplePost("cakes")).toBeNull();
  });

  it("still shows samples when the real feed fails", async () => {
    vi.stubEnv("SAMPLE_POSTS_ENABLED", "true");
    mockSearch.mockRejectedValue(new Error("Posts could not be loaded"));
    const items = await loadShowroomItems("market");
    expect(items.map((item) => item.id)).toEqual(["sample-bakkie"]);
  });

  it("finds a shown sample by slug", async () => {
    vi.stubEnv("SAMPLE_POSTS_ENABLED", "true");
    expect((await findSamplePost("expo"))?.title).toBe("Sample expo");
    expect(await findSamplePost("missing")).toBeNull();
  });
});

describe("resolveSamplePosts", () => {
  it("skips invalid and duplicate entries and serves local media from the preview folder", () => {
    const resolved = resolveSamplePosts([
      { source: "committed", entries: [entry("cakes", "business", "food_dining")] },
      {
        source: "local",
        entries: [
          { ...entry("cakes", "business", "food_dining"), videoKey: "a.mp4", posterKey: "a.jpg" },
          { ...entry("bad", "market", "food_dining"), videoKey: "b.mp4", posterKey: "b.jpg" },
          {
            ...entry("farm", "market", "farming_agriculture"),
            videoKey: "Farm 1.mp4",
            posterKey: "farm.jpg",
          },
        ],
      },
    ]);
    expect(resolved.map((post) => [post.slug, post.source])).toEqual([
      ["cakes", "committed"],
      ["farm", "local"],
    ]);
    expect(resolved[1].videoUrl).toBe("/sample-posts-local/Farm%201.mp4");
  });
});
