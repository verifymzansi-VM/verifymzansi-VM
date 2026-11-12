import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoplayPolicyProvider } from "@/contexts/autoplay-policy-context";
import { ShowroomCardCarousel, type CarouselItem } from "./showroom-card-carousel";

// The pause control and the live region of the desktop showroom (WCAG 2.2.2;
// ARIA carousel pattern: announcements are off while the slides change by
// themselves).

const { reducedMotion } = vi.hoisted(() => ({ reducedMotion: { value: false } }));

vi.mock("@/hooks/use-reduced-motion", () => ({
  useReducedMotion: () => reducedMotion.value,
}));

vi.mock("@/components/listings/poster-card-shell", () => ({
  PosterCardShell: ({ href, title }: { href: string; title: string }) => (
    <a href={href} aria-label={`Open ${title}`}>
      {title}
    </a>
  ),
}));

const items: CarouselItem[] = [1, 2, 3].map((n) => ({
  id: String(n),
  type: "listing",
  href: `/listing/${n}`,
  title: `Post ${n}`,
  mediaUrl: `/post-${n}.jpg`,
}));

class VisibleIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    callback(
      [{ isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
  observe() {}
  disconnect() {}
  unobserve() {}
}

function liveRegion() {
  return screen.getByText(/^Slide \d of 3$/);
}

beforeEach(() => {
  reducedMotion.value = false;
  vi.stubGlobal("IntersectionObserver", VisibleIntersectionObserver);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("showroom rotation control", () => {
  it("offers a pause button and keeps automatic moves silent while the slides rotate", () => {
    render(<ShowroomCardCarousel items={items} imageDisplayMs={100} />);

    expect(screen.getByRole("button", { name: "Pause slides" })).toBeInTheDocument();
    expect(liveRegion()).toHaveAttribute("aria-live", "off");

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(liveRegion()).toHaveTextContent("Slide 2 of 3");
  });

  it("stops the automatic moves when paused, announces again, and restarts on play", () => {
    render(<ShowroomCardCarousel items={items} imageDisplayMs={100} />);

    fireEvent.click(screen.getByRole("button", { name: "Pause slides" }));
    expect(screen.getByRole("button", { name: "Play slides" })).toBeInTheDocument();
    expect(liveRegion()).toHaveAttribute("aria-live", "polite");

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(liveRegion()).toHaveTextContent("Slide 1 of 3");

    fireEvent.click(screen.getByRole("button", { name: "Play slides" }));
    expect(liveRegion()).toHaveAttribute("aria-live", "off");
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(liveRegion()).toHaveTextContent("Slide 2 of 3");
  });

  it("is the first control in the showroom's tab order", () => {
    render(<ShowroomCardCarousel items={items} imageDisplayMs={100} />);

    const pause = screen.getByRole("button", { name: "Pause slides" });
    const slides = screen.getByLabelText("Carousel slides");
    expect(pause.compareDocumentPosition(slides) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("announces the visitor's own moves while focus is on the slides", () => {
    render(<ShowroomCardCarousel items={items} imageDisplayMs={100} />);

    const slides = screen.getByLabelText("Carousel slides");
    fireEvent.focus(slides);
    expect(liveRegion()).toHaveAttribute("aria-live", "polite");
    fireEvent.keyDown(slides, { key: "ArrowRight" });
    expect(liveRegion()).toHaveTextContent("Slide 2 of 3");

    fireEvent.blur(slides, { relatedTarget: document.body });
    expect(liveRegion()).toHaveAttribute("aria-live", "off");
  });

  it("keeps holding the slides for keyboard focus when the mouse leaves them", () => {
    render(<ShowroomCardCarousel items={items} imageDisplayMs={100} />);

    const slides = screen.getByLabelText("Carousel slides");
    fireEvent.focus(slides);
    fireEvent.mouseEnter(slides);
    fireEvent.mouseLeave(slides);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(liveRegion()).toHaveTextContent("Slide 1 of 3");
    expect(liveRegion()).toHaveAttribute("aria-live", "polite");
  });

  it("has no pause button where the slides never move by themselves", () => {
    const { rerender } = render(
      <AutoplayPolicyProvider disableAutoplay>
        <ShowroomCardCarousel items={items} />
      </AutoplayPolicyProvider>
    );
    expect(screen.queryByRole("button", { name: /slides$/ })).toBeNull();
    expect(liveRegion()).toHaveAttribute("aria-live", "polite");

    reducedMotion.value = true;
    rerender(<ShowroomCardCarousel items={items} />);
    expect(screen.queryByRole("button", { name: /slides$/ })).toBeNull();
    expect(liveRegion()).toHaveAttribute("aria-live", "polite");

    reducedMotion.value = false;
    rerender(<ShowroomCardCarousel items={[items[0]]} />);
    expect(screen.queryByRole("button", { name: /slides$/ })).toBeNull();
  });
});
