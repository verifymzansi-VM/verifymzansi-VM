import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ShowroomCardCarousel,
  type CarouselItem,
} from "@/components/showrooms/showroom-card-carousel";
import { BusinessCard } from "@/components/listings/business-card";
import { ListingCardList } from "@/components/listings/listing-card-list";
import { MarketPreviewCard } from "@/components/home/market-preview-card";
import { BusinessPreviewCard } from "@/components/home/business-preview-card";
import { MzansiMarketGrid } from "@/app/(marketplace)/mzansi-market/grid";

// Cards decide "photo or video" from the post's own media (the stored kind),
// not from a file extension: the live backend's media keys have none.

const VIDEO_URL = "https://media.verifymzansi.com/media/3f2a9c1e-1b2c-4d5e-8f90-123456789abc";
const PHOTO_URL = "https://media.verifymzansi.com/media/11111111-2222-4333-8444-555555555555";

const { posterCardShellMock, videoCardPlayerMock, useMarketplaceStoreMock, fetchMock } = vi.hoisted(
  () => ({
    posterCardShellMock: vi.fn(
      ({ title, mediaUrl, isVideo }: { title: string; mediaUrl?: string; isVideo?: boolean }) => (
        <div
          data-testid="poster-card"
          data-title={title}
          data-media-url={mediaUrl ?? ""}
          data-is-video={isVideo === undefined ? "unset" : String(isVideo)}
        />
      )
    ),
    videoCardPlayerMock: vi.fn(({ isVideo }: { isVideo?: boolean }) => (
      <div data-testid="video-card-player" data-is-video={String(isVideo)} />
    )),
    useMarketplaceStoreMock: vi.fn(),
    fetchMock: vi.fn(),
  })
);

vi.mock("@/components/listings/poster-card-shell", () => ({
  PosterCardShell: posterCardShellMock,
}));

vi.mock("@/components/ui/video-card-player", () => ({
  VideoCardPlayer: videoCardPlayerMock,
  // The fallback for older posts: the file extension only.
  isVideoUrl: (url?: string | null) => /\.(mp4|webm|ogg|mov)$/i.test(url?.split("?")[0] ?? ""),
}));

vi.mock("@/components/ui/video-view-tracker", () => ({
  VideoViewTracker: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/home/auto-scroll-rail", () => ({
  useAutoScrollRailItemState: () => ({ isActive: true, isRailDragging: false }),
}));

vi.mock("@/components/listings/affiliation-badge", () => ({
  AffiliationBadge: () => null,
}));

vi.mock("@/hooks/use-reduced-motion", () => ({ useReducedMotion: () => false }));

vi.mock("@/stores", () => ({ useMarketplaceStore: useMarketplaceStoreMock }));

vi.mock("@/components/listings/listing-skeleton", () => ({
  ListingGridSkeleton: () => <div data-testid="listing-skeleton" />,
}));

function cards() {
  return screen
    .getAllByTestId("poster-card")
    .filter((card) => card.getAttribute("data-title") !== "Carousel sizing card");
}

beforeEach(() => {
  vi.clearAllMocks();
  class MockIntersectionObserver {
    constructor(callback: IntersectionObserverCallback) {
      callback(
        [{ isIntersecting: true, intersectionRatio: 0.5 } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver
      );
    }
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

describe("showroom cards", () => {
  const items: CarouselItem[] = [
    {
      id: "video-post",
      type: "promotion",
      href: "/tourism-events/video-post",
      title: "Video post",
      mediaUrl: VIDEO_URL,
      mediaKind: "video",
      posterUrl: PHOTO_URL,
    },
    {
      id: "photo-post",
      type: "listing",
      href: "/listing/photo-post",
      title: "Photo post",
      mediaUrl: PHOTO_URL,
      mediaKind: "image",
    },
    {
      id: "older-post",
      type: "business",
      href: "/mzansi-business/older-post",
      title: "Older post",
      mediaUrl: "https://media.verifymzansi.com/media/listing/abc/clip.mp4",
      posterUrl: "https://media.verifymzansi.com/media/listing/abc/poster.jpg",
    },
  ];

  it("plays a stored video on the front card and shows its poster on side cards", () => {
    const { unmount } = render(<ShowroomCardCarousel items={items} />);
    const [front, ...sides] = cards();
    expect(front).toHaveAttribute("data-title", "Video post");
    expect(front).toHaveAttribute("data-media-url", VIDEO_URL);
    expect(front).toHaveAttribute("data-is-video", "true");
    for (const side of sides) expect(side).toHaveAttribute("data-is-video", "false");
    unmount();

    // The same post as a side card shows its photo, not a video.
    render(<ShowroomCardCarousel items={[items[1], items[0]]} />);
    const videoSide = cards().find((card) => card.getAttribute("data-title") === "Video post");
    expect(videoSide).toHaveAttribute("data-media-url", PHOTO_URL);
    expect(videoSide).toHaveAttribute("data-is-video", "false");
  });

  it("keeps a stored photo a photo", () => {
    render(<ShowroomCardCarousel items={[items[1], items[2]]} />);
    expect(cards()[0]).toHaveAttribute("data-is-video", "false");
  });

  it("recognises an older .mp4 post without a stored kind", () => {
    render(<ShowroomCardCarousel items={[items[2], items[1]]} />);
    expect(cards()[0]).toHaveAttribute("data-is-video", "true");
  });
});

describe("area and home cards", () => {
  it("shows a business's cover video as a video", () => {
    render(
      <BusinessCard
        id="b1"
        businessName="Video business"
        businessType="standalone_shop"
        coverVideo={VIDEO_URL}
        coverPhoto={PHOTO_URL}
        province="Gauteng"
        city="Johannesburg"
      />
    );
    expect(cards()[0]).toHaveAttribute("data-media-url", VIDEO_URL);
    expect(cards()[0]).toHaveAttribute("data-is-video", "true");
  });

  it("shows a business without a cover video as a photo", () => {
    render(
      <BusinessCard
        id="b2"
        businessName="Photo business"
        businessType="standalone_shop"
        coverPhoto={PHOTO_URL}
        province="Gauteng"
        city="Johannesburg"
      />
    );
    expect(cards()[0]).toHaveAttribute("data-is-video", "false");
  });

  it("passes the home rails' video flag through", () => {
    render(
      <>
        <MarketPreviewCard
          href="/listing/1"
          imageUrl={VIDEO_URL}
          isVideo
          title="Home market video"
          price={null}
          city="Durban"
          provinceCode="KZN"
        />
        <BusinessPreviewCard
          href="/mzansi-business/1"
          imageUrl={VIDEO_URL}
          isVideo
          title="Home business video"
          businessType="standalone_shop"
          city="Durban"
          provinceCode="KZN"
        />
      </>
    );
    for (const card of cards()) expect(card).toHaveAttribute("data-is-video", "true");
  });

  it("plays a stored video in the market list view", () => {
    const { unmount } = render(
      <ListingCardList
        id="l1"
        title="List video"
        price={0}
        imageUrl={VIDEO_URL}
        isVideo
        province="Gauteng"
        city="Johannesburg"
        category="electronics"
        createdAt="2026-11-01T00:00:00.000Z"
      />
    );
    expect(screen.getByTestId("video-card-player")).toHaveAttribute("data-is-video", "true");
    unmount();

    render(
      <ListingCardList
        id="l2"
        title="List photo"
        price={0}
        imageUrl={PHOTO_URL}
        isVideo={false}
        province="Gauteng"
        city="Johannesburg"
        category="electronics"
        createdAt="2026-11-01T00:00:00.000Z"
      />
    );
    expect(screen.queryByTestId("video-card-player")).toBeNull();
  });

  it("gives the market grid's card the listing's video", async () => {
    vi.stubGlobal("fetch", fetchMock);
    useMarketplaceStoreMock.mockReturnValue({
      filters: { sort: "newest", attributes: {} },
      page: 1,
      setPage: vi.fn(),
      setFilter: vi.fn(),
      resetFilters: vi.fn(),
    });
    const listing = (id: string, videos: string[]) => ({
      id,
      title: `Grid ${id}`,
      description: "Grid card",
      price_cents: 1000,
      price_negotiable: false,
      location_province: "Gauteng",
      location_city: "Johannesburg",
      category: "electronics",
      condition: "used",
      attributes: {},
      created_at: "2026-11-01T00:00:00.000Z",
      photos: [PHOTO_URL],
      videos,
      video_thumbnail: PHOTO_URL,
      logo_url: null,
      boost_until: null,
      featured: false,
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        listings: [listing("with-video", [VIDEO_URL]), listing("photo-only", [])],
        sellers: [],
        total: 2,
        page: 1,
        limit: 24,
      }),
    });

    render(<MzansiMarketGrid />);
    await waitFor(() => expect(cards()).toHaveLength(2));
    const [withVideo, photoOnly] = cards();
    expect(withVideo).toHaveAttribute("data-media-url", VIDEO_URL);
    expect(withVideo).toHaveAttribute("data-is-video", "true");
    expect(photoOnly).toHaveAttribute("data-media-url", PHOTO_URL);
    expect(photoOnly).toHaveAttribute("data-is-video", "false");
  });
});
