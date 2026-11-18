import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShowroomCardCarousel, type CarouselItem } from "./showroom-card-carousel";

const { cardProps, mockTrack } = vi.hoisted(() => ({
  cardProps: [] as Record<string, unknown>[],
  mockTrack: vi.fn(),
}));

vi.mock("@/hooks/use-reduced-motion", () => ({ useReducedMotion: () => false }));
vi.mock("@/lib/analytics/commercial-events", () => ({ trackCommercialEvents: mockTrack }));
vi.mock("@/components/listings/poster-card-shell", () => ({
  PosterCardShell: (props: Record<string, unknown>) => {
    cardProps.push(props);
    return <div data-testid="poster-card">{String(props.title)}</div>;
  },
}));

const real: CarouselItem = {
  id: "real-1",
  type: "business",
  href: "/mzansi-business/real-1",
  title: "Real business",
  mediaUrl: "/real.jpg",
};
const sample: CarouselItem = {
  id: "sample-cakes",
  type: "business",
  href: "/sample/cakes",
  title: "Sample cakes",
  mediaUrl: "/sample-posts-local/cakes.mp4",
  sample: true,
};

beforeEach(() => {
  cardProps.length = 0;
  mockTrack.mockClear();
  vi.useFakeTimers();
  class VisibleObserver {
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
  vi.stubGlobal("IntersectionObserver", VisibleObserver);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ShowroomCardCarousel with sample posts", () => {
  it("labels sample cards and never reports their views or appearances", () => {
    render(<ShowroomCardCarousel items={[sample, real]} surface="showroom:home" />);
    const sampleCard = cardProps.findLast((props) => props.title === "Sample cakes");
    expect(sampleCard).toMatchObject({
      sample: true,
      viewTarget: undefined,
      viewSurface: undefined,
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("still reports real posts as before", () => {
    render(<ShowroomCardCarousel items={[real, sample]} surface="showroom:home" />);
    const realCard = cardProps.findLast((props) => props.title === "Real business");
    expect(realCard).toMatchObject({
      viewTarget: { type: "business", id: "real-1" },
      viewSurface: "showroom:home",
    });
    expect(realCard?.sample).toBeFalsy();
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(mockTrack).toHaveBeenCalledWith([
      expect.objectContaining({ id: "real-1", type: "showroom_appearance" }),
    ]);
  });
});
