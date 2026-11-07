import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Catalogue from "./catalogue";
import type { SamplePostEntry } from "./catalogue";

const { mockRpc, mockSearch, approved } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockSearch: vi.fn(),
  approved: [] as SamplePostEntry[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/foundation/server-public", () => ({
  foundationServerPublicApi: () => ({ rpc: mockRpc }),
}));
vi.mock("@/lib/foundation/public-cards", () => ({
  searchFoundationCards: mockSearch,
  foundationMediaUrl: () => null,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mockRpc }) }));
vi.mock("@/lib/utils/logger", () => ({ createLogger: () => ({ warn: vi.fn(), error: vi.fn() }) }));
vi.mock("./catalogue", async (importOriginal) => ({
  ...(await importOriginal<typeof Catalogue>()),
  APPROVED_SAMPLE_POSTS: approved,
}));

import { loadShowroomItems } from "@/lib/showroom/feed";
import { findSamplePost, listSamplePosts, resolveSamplePosts } from "./load";

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
  businessName: `Business ${slug}`,
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
      entry("lodge", "business", "tourism_hospitality"),
      entry("bakkie", "market", "vehicles"),
      entry("expo", "event", "market_expo")
    );
    vi.stubEnv("NEXT_PUBLIC_DATA_BACKEND", "foundation");
    mockSearch.mockResolvedValue({ items: [foundationCard("r1"), foundationCard("r2")] });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("shows nothing while the switch is off", async () => {
    const items = await loadShowroomItems("home", { province: null });
    expect(items.map((item) => item.id)).toEqual(["r1", "r2"]);
    expect(await listSamplePosts()).toEqual([]);
    expect(await findSamplePost("cakes")).toBeNull();
  });

  it("puts samples after every real post, labelled as samples", async () => {
    vi.stubEnv("SAMPLE_POSTS_ENABLED", "true");
    const items = await loadShowroomItems("home", { province: null });
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
      mediaUrl: "https://media.verifymzansi.com/media/samples/cakes.mp4",
      posterUrl: "https://media.verifymzansi.com/media/samples/cakes.webp",
    });
  });

  it.each([
    ["business", ["sample-cakes", "sample-lodge"]],
    ["market", ["sample-bakkie"]],
    ["tourism", ["sample-lodge", "sample-expo"]],
  ] as const)("matches samples to the %s showroom", async (surface, expected) => {
    vi.stubEnv("SAMPLE_POSTS_ENABLED", "true");
    const items = await loadShowroomItems(surface, { province: null });
    expect(items.filter((item) => item.sample).map((item) => item.id)).toEqual(expected);
  });

  it("still shows samples when the real feed fails", async () => {
    vi.stubEnv("SAMPLE_POSTS_ENABLED", "true");
    mockSearch.mockRejectedValue(new Error("Posts could not be loaded"));
    const items = await loadShowroomItems("market", { province: null });
    expect(items.map((item) => item.id)).toEqual(["sample-bakkie"]);
  });

  it("finds a published sample by slug", async () => {
    vi.stubEnv("SAMPLE_POSTS_ENABLED", "true");
    expect((await findSamplePost("expo"))?.businessName).toBe("Business expo");
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
