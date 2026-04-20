import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  ShowroomCardCarousel,
  type CarouselItem,
  type ShowroomDecorativeBackground,
} from "./showroom-card-carousel";

vi.mock("@/hooks/use-reduced-motion", () => ({
  useReducedMotion: () => false,
}));

vi.mock("@/components/listings/poster-card-shell", () => ({
  PosterCardShell: ({
    href,
    title,
    description,
    videoMode,
    mediaUrl,
    showPlaybackControl,
    makeEntireCardClickable,
    deferVideoLoadUntilPlay,
  }: {
    href: string;
    title: string;
    description?: string;
    videoMode?: string;
    mediaUrl?: string;
    showPlaybackControl?: boolean;
    makeEntireCardClickable?: boolean;
    deferVideoLoadUntilPlay?: boolean;
  }) => (
    <div
      data-testid="poster-card"
      data-video-mode={videoMode}
      data-media-url={mediaUrl}
      data-defer={deferVideoLoadUntilPlay ? "yes" : "no"}
    >
      <div data-testid={`poster-card-surface-${title}`}>{title}</div>
      {description && <span>{description}</span>}
      {showPlaybackControl ? (
        <>
          <button type="button" data-carousel-control="true">
            Playback
          </button>
          {makeEntireCardClickable ? (
            <a href={href} aria-label={`Open ${title}`}>
              Open {title}
            </a>
          ) : (
            <a href={href}>Open {title}</a>
          )}
        </>
      ) : (
        <a href={href}>Open {title}</a>
      )}
    </div>
  ),
}));

const mockItems: CarouselItem[] = [
  {
    id: "1",
    type: "listing",
    href: "/listing/1",
    title: "Test Listing",
    description: "A test listing",
    location: "Cape Town",
    mediaUrl: "/test.jpg",
  },
  {
    id: "2",
    type: "business",
    href: "/mzansi-business/2",
    title: "Test Business",
    description: "A test business",
    location: "Johannesburg",
    mediaUrl: "/test2.jpg",
  },
  {
    id: "3",
    type: "promotion",
    href: "/tourism-events/3",
    title: "Test Event",
    description: "A test event",
    location: "Durban",
    mediaUrl: "/test3.jpg",
  },
];

const denseItems: CarouselItem[] = Array.from({ length: 7 }, (_, index) => ({
  id: `dense-${index + 1}`,
  type: "listing" as const,
  href: `/listing/dense-${index + 1}`,
  title: `Dense ${index + 1}`,
  description: `Dense card ${index + 1}`,
  location: "Johannesburg",
  mediaUrl: `/dense-${index + 1}.jpg`,
}));

const expandedItems: CarouselItem[] = Array.from({ length: 15 }, (_, index) => ({
  id: `expanded-${index + 1}`,
  type: (index % 3 === 0 ? "listing" : index % 3 === 1 ? "business" : "promotion") as
    | "listing"
    | "business"
    | "promotion",
  href: `/expanded/${index + 1}`,
  title: `Expanded ${index + 1}`,
  description: `Expanded card ${index + 1}`,
  location: "South Africa",
  mediaUrl: `/expanded-${index + 1}.jpg`,
}));

const mockBackground: ShowroomDecorativeBackground = {
  src: "/images/showrooms/test-desktop.jpg",
  mobileSrc: "/images/showrooms/test-mobile.jpg",
  objectPosition: "center 38%",
  mobileObjectPosition: "center 22%",
  overlayPreset: "market",
  blurPx: 18,
  dimOpacity: 0.48,
};

// Stub IntersectionObserver
beforeEach(() => {
  class MockIntersectionObserver {
    constructor(cb: IntersectionObserverCallback) {
      cb(
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

describe("ShowroomCardCarousel", () => {
  it("renders the carousel section with correct aria attributes", () => {
    render(<ShowroomCardCarousel items={mockItems} />);
    const section =
      screen.getByRole("region", { hidden: true }) ?? screen.getByLabelText("Showroom carousel");
    expect(section || screen.getByLabelText("Showroom carousel")).toBeTruthy();
  });

  it("fills the desktop viewport while removing mobile top spacing", () => {
    render(<ShowroomCardCarousel items={mockItems} />);
    const section = screen.getByLabelText("Showroom carousel");

    expect(section.className).toContain("pt-0");
    expect(section.className).toContain("sm:pt-0");
    expect(section.className).toContain("pb-2");
    expect(section.className).toContain("sm:pb-4");
    expect(section.className).toContain("lg:min-h-[clamp(30rem,62vh,40rem)]");
    expect(section.className).toContain("lg:py-8");
  });

  it("uses the larger mobile showroom card width while preserving desktop card sizing", () => {
    render(<ShowroomCardCarousel items={mockItems} />);

    const centerSlide = screen.getByRole("group", { name: "1 of 3" });
    expect(centerSlide.className).toContain("w-[72vw]");
    expect(centerSlide.className).toContain("max-w-[280px]");
    expect(centerSlide.className).toContain("sm:w-[58vw]");
    expect(centerSlide.className).toContain("sm:max-w-[360px]");
    expect(centerSlide.className).toContain("lg:w-[280px]");
    expect(centerSlide.className).toContain("xl:w-[304px]");
  });

  it("renders slide groups with positional labels", () => {
    render(<ShowroomCardCarousel items={mockItems} />);
    expect(screen.getByRole("group", { name: "1 of 3" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "2 of 3" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "3 of 3" })).toBeInTheDocument();
  });

  it("renders all card items as links", () => {
    render(<ShowroomCardCarousel items={mockItems} />);
    const cards = screen.getAllByTestId("poster-card");
    // Includes the invisible placeholder + 3 real cards
    expect(cards.length).toBeGreaterThanOrEqual(mockItems.length);
  });

  it("renders navigation dots for multiple items", () => {
    render(<ShowroomCardCarousel items={mockItems} />);
    const dots = screen.getAllByRole("button", { name: /go to slide/i });
    expect(dots).toHaveLength(mockItems.length);
  });

  it("does not render navigation dots for single item", () => {
    render(<ShowroomCardCarousel items={[mockItems[0]]} />);
    const dots = screen.queryAllByRole("button", { name: /go to slide/i });
    expect(dots).toHaveLength(0);
  });

  it("renders empty state when no items provided", () => {
    const { container } = render(
      <ShowroomCardCarousel items={[]} emptyTitle="No Items" emptyDescription="Nothing to show" />
    );
    const section = screen.getByLabelText("Showroom carousel");
    const emptyStateCard = Array.from(container.querySelectorAll("div")).find(
      (node) =>
        node.className.includes("w-[72vw]") &&
        node.className.includes("max-w-[280px]") &&
        node.className.includes("sm:w-[58vw]") &&
        node.className.includes("sm:max-w-[360px]") &&
        node.className.includes("lg:w-[280px]") &&
        node.className.includes("xl:w-[304px]")
    );
    expect(section).toBeInTheDocument();
    expect(section.className).toContain("lg:min-h-[clamp(30rem,62vh,40rem)]");
    expect(emptyStateCard).toBeDefined();
    expect(screen.getByText("No Items")).toBeInTheDocument();
    expect(screen.getByText("Nothing to show")).toBeInTheDocument();
  });

  it("renders decorative showroom background layers when configured", () => {
    const { container } = render(
      <ShowroomCardCarousel items={mockItems} background={mockBackground} />
    );

    const desktopBackground = container.querySelector('[data-showroom-background="desktop"]');
    const mobileBackground = container.querySelector('[data-showroom-background="mobile"]');

    expect(desktopBackground).toHaveAttribute(
      "src",
      expect.stringContaining(encodeURIComponent("/images/showrooms/test-desktop.jpg"))
    );
    expect(mobileBackground).toHaveAttribute(
      "src",
      expect.stringContaining(encodeURIComponent("/images/showrooms/test-mobile.jpg"))
    );
  });

  it("keeps the default gradient-only shell when no decorative background is provided", () => {
    const { container } = render(<ShowroomCardCarousel items={mockItems} />);

    expect(container.querySelector('[data-showroom-background="desktop"]')).toBeNull();
    expect(container.querySelector('[data-showroom-background="mobile"]')).toBeNull();
  });

  it("preserves the empty state when a decorative background is provided", () => {
    const { container } = render(
      <ShowroomCardCarousel
        items={[]}
        background={mockBackground}
        emptyTitle="No Items"
        emptyDescription="Nothing to show"
      />
    );

    expect(screen.getByText("No Items")).toBeInTheDocument();
    expect(container.querySelector('[data-showroom-background="desktop"]')).toBeTruthy();
  });

  it("navigates to next slide on dot click", () => {
    render(<ShowroomCardCarousel items={mockItems} />);
    const dots = screen.getAllByRole("button", { name: /go to slide/i });
    fireEvent.click(dots[1]);
    // Re-query after re-render to avoid stale DOM references
    const updatedDots = screen.getAllByRole("button", { name: /go to slide/i });
    expect(updatedDots[1].innerHTML).toContain("bg-brand-green");
  });

  it("announces active slide changes via aria-live", () => {
    render(<ShowroomCardCarousel items={mockItems} />);
    expect(screen.getByText("Slide 1 of 3")).toBeInTheDocument();

    const dots = screen.getAllByRole("button", { name: /go to slide/i });
    fireEvent.click(dots[2]);

    expect(screen.getByText("Slide 3 of 3")).toBeInTheDocument();
  });

  it("supports keyboard navigation", () => {
    render(<ShowroomCardCarousel items={mockItems} />);
    const group = screen.getByLabelText(/carousel slides/i);
    fireEvent.keyDown(group, { key: "ArrowRight" });
    const dots = screen.getAllByRole("button", { name: /go to slide/i });
    expect(dots[1].innerHTML).toContain("bg-brand-green");
  });

  it("registers pointer event handlers on carousel area", () => {
    render(<ShowroomCardCarousel items={mockItems} />);
    const group = screen.getByLabelText(/carousel slides/i);
    // Verify the carousel area supports grab/drag interaction
    expect(group.className).toContain("cursor-grab");
    expect(group.className).toContain("touch-pan-y");
    expect(group.className).toContain("select-none");
  });

  it("swipes left to the next card in sequence", () => {
    render(<ShowroomCardCarousel items={mockItems} />);
    const group = screen.getByLabelText(/carousel slides/i);

    fireEvent.pointerDown(group, { clientX: 240, pointerId: 1 });
    fireEvent.pointerMove(group, { clientX: 120, pointerId: 1 });
    fireEvent.pointerUp(group, { clientX: 120, pointerId: 1 });

    expect(screen.getByText("Slide 2 of 3")).toBeInTheDocument();
    const dots = screen.getAllByRole("button", { name: /go to slide/i });
    expect(dots[1].innerHTML).toContain("bg-brand-green");
  });

  it("keeps slot transforms anchored instead of using shared drag translation classes", () => {
    render(<ShowroomCardCarousel items={mockItems} />);

    const slide = screen.getByRole("group", { name: "1 of 3" });
    expect(slide.className).not.toContain("drag-x");
  });

  it("swipes right to the previous card in sequence", () => {
    render(<ShowroomCardCarousel items={mockItems} />);
    const group = screen.getByLabelText(/carousel slides/i);

    fireEvent.pointerDown(group, { clientX: 120, pointerId: 1 });
    fireEvent.pointerMove(group, { clientX: 250, pointerId: 1 });
    fireEvent.pointerUp(group, { clientX: 250, pointerId: 1 });

    expect(screen.getByText("Slide 3 of 3")).toBeInTheDocument();
    const dots = screen.getAllByRole("button", { name: /go to slide/i });
    expect(dots[2].innerHTML).toContain("bg-brand-green");
  });

  it("supports drag gestures that begin on the nested active card link surface", () => {
    render(<ShowroomCardCarousel items={mockItems} />);
    const activeLink = screen.getByRole("link", { name: "Open Test Listing" });

    fireEvent.pointerDown(activeLink, { clientX: 240, pointerId: 1 });
    fireEvent.pointerMove(activeLink, { clientX: 120, pointerId: 1 });
    fireEvent.pointerUp(activeLink, { clientX: 120, pointerId: 1 });

    expect(screen.getByText("Slide 2 of 3")).toBeInTheDocument();
  });

  it("treats side-card drags as carousel rotation instead of a recenter click", () => {
    render(<ShowroomCardCarousel items={mockItems} />);
    const sideLink = screen.getByRole("link", { name: "Open Test Business" });

    fireEvent.pointerDown(sideLink, { clientX: 120, pointerId: 1 });
    fireEvent.pointerMove(sideLink, { clientX: 250, pointerId: 1 });
    fireEvent.pointerUp(sideLink, { clientX: 250, pointerId: 1 });

    expect(screen.getByText("Slide 3 of 3")).toBeInTheDocument();
  });

  it("passes ambient videoMode to center card", () => {
    render(<ShowroomCardCarousel items={mockItems} />);
    const cards = screen.getAllByTestId("poster-card");
    // The invisible placeholder has no videoMode, real cards do
    const ambientCards = cards.filter((c) => c.getAttribute("data-video-mode") === "ambient");
    expect(ambientCards.length).toBe(1);
  });

  it("autoplays the center card immediately instead of deferring hero playback", () => {
    render(<ShowroomCardCarousel items={mockItems} />);
    const cards = screen.getAllByTestId("poster-card");
    const ambientCard = cards.find((card) => card.getAttribute("data-video-mode") === "ambient");

    expect(ambientCard).toHaveAttribute("data-defer", "no");
  });

  it("keeps playable video source on center card only", () => {
    const videoItems: CarouselItem[] = [
      {
        id: "v1",
        type: "listing",
        href: "/listing/v1",
        title: "Center Video",
        mediaUrl: "https://cdn.example.com/center.mp4",
      },
      {
        id: "v2",
        type: "listing",
        href: "/listing/v2",
        title: "Side Video No Poster",
        mediaUrl: "https://cdn.example.com/side.mp4",
      },
      {
        id: "v3",
        type: "listing",
        href: "/listing/v3",
        title: "Side Video With Poster",
        mediaUrl: "https://cdn.example.com/side2.mp4",
        posterUrl: "https://cdn.example.com/side2.jpg",
      },
    ];

    render(<ShowroomCardCarousel items={videoItems} />);
    const cards = screen.getAllByTestId("poster-card");
    const realCards = cards.slice(1); // skip invisible placeholder card

    const center = realCards.find((c) => c.getAttribute("data-video-mode") === "ambient");
    expect(center?.getAttribute("data-media-url")).toBe("https://cdn.example.com/center.mp4");

    const sideCards = realCards.filter((c) => c.getAttribute("data-video-mode") !== "ambient");
    expect(sideCards).toHaveLength(2);
    expect(sideCards[0].getAttribute("data-media-url")).toBe("/images/fallbacks/hero-shop.svg");
    expect(sideCards[1].getAttribute("data-media-url")).toBe("https://cdn.example.com/side2.jpg");
  });

  it("relies on swipe gestures and dots rather than a separate mobile button row", () => {
    render(<ShowroomCardCarousel items={mockItems} />);
    expect(
      screen.queryByRole("button", { name: /return to previous card/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /skip to next card/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /go to slide/i })).toHaveLength(mockItems.length);
  });

  it("renders an active card link to the detail page", () => {
    render(<ShowroomCardCarousel items={mockItems} />);
    const activeLink = screen.getByRole("link", { name: "Open Test Listing" });
    expect(activeLink).toHaveAttribute("href", "/listing/1");
  });

  it("recenters a side card before navigation instead of opening it immediately", () => {
    render(<ShowroomCardCarousel items={mockItems} />);
    fireEvent.click(screen.getByText("Open Test Business"));
    expect(screen.getByText("Slide 2 of 3")).toBeInTheDocument();
  });

  it("does not navigate when playback controls are tapped", () => {
    render(<ShowroomCardCarousel items={mockItems} />);
    fireEvent.click(screen.getByRole("button", { name: "Playback" }));
    expect(screen.getByText("Slide 1 of 3")).toBeInTheDocument();
  });

  it("renders exactly one playable center card at a time", () => {
    render(<ShowroomCardCarousel items={mockItems} />);
    expect(screen.getAllByRole("button", { name: "Playback" })).toHaveLength(1);
  });

  it("renders the wider desktop stack when seven cards are available", () => {
    render(<ShowroomCardCarousel items={denseItems} />);

    expect(screen.getByRole("group", { name: "1 of 7" })).toHaveAttribute("data-slot-offset", "0");
    expect(screen.getByRole("group", { name: "4 of 7" })).toHaveAttribute("data-slot-offset", "3");
    expect(screen.getByRole("group", { name: "5 of 7" })).toHaveAttribute("data-slot-offset", "-3");
  });

  it("renders the simplified desktop stack without extra support cards", () => {
    const { container } = render(<ShowroomCardCarousel items={expandedItems} />);

    const supportCards = container.querySelectorAll('[data-showroom-layer="support"]');
    const activeCards = container.querySelectorAll('[data-showroom-layer="active"]');
    const stackCards = container.querySelectorAll('[data-showroom-layer="stack"]');

    expect(supportCards).toHaveLength(0);
    expect(activeCards).toHaveLength(1);
    expect(stackCards).toHaveLength(6);
  });
});
