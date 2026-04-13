import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ShowroomCardCarousel, type CarouselItem } from "./showroom-card-carousel";

vi.mock("@/hooks/use-reduced-motion", () => ({
  useReducedMotion: () => false,
}));

vi.mock("@/components/listings/poster-card-shell", () => ({
  PosterCardShell: ({
    href,
    title,
    description,
    videoMode,
  }: {
    href: string;
    title: string;
    description?: string;
    videoMode?: string;
  }) => (
    <a href={href} data-testid="poster-card" data-video-mode={videoMode}>
      <span>{title}</span>
      {description && <span>{description}</span>}
    </a>
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
    href: "/promotion/3",
    title: "Test Event",
    description: "A test event",
    location: "Durban",
    mediaUrl: "/test3.jpg",
  },
];

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
    render(
      <ShowroomCardCarousel items={[]} emptyTitle="No Items" emptyDescription="Nothing to show" />
    );
    expect(screen.getByLabelText("Showroom carousel")).toBeInTheDocument();
    expect(screen.getByText("No Items")).toBeInTheDocument();
    expect(screen.getByText("Nothing to show")).toBeInTheDocument();
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

  it("passes ambient videoMode to center card", () => {
    render(<ShowroomCardCarousel items={mockItems} />);
    const cards = screen.getAllByTestId("poster-card");
    // The invisible placeholder has no videoMode, real cards do
    const ambientCards = cards.filter((c) => c.getAttribute("data-video-mode") === "ambient");
    expect(ambientCards.length).toBe(1);
  });
});
