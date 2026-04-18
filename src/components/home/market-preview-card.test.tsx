import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarketPreviewCard } from "./market-preview-card";

const { posterCardSpy, railStateSpy } = vi.hoisted(() => ({
  posterCardSpy: vi.fn(),
  railStateSpy: vi.fn(),
}));

vi.mock("@/components/listings/poster-card-shell", () => ({
  PosterCardShell: (props: unknown) => {
    posterCardSpy(props);
    return <div data-testid="poster-card-shell" />;
  },
}));

vi.mock("@/components/home/auto-scroll-rail", () => ({
  useAutoScrollRailItemState: () => railStateSpy(),
}));

describe("MarketPreviewCard", () => {
  beforeEach(() => {
    posterCardSpy.mockClear();
    railStateSpy.mockReset();
  });

  it("enables feed playback only for the centered non-dragging card", () => {
    railStateSpy.mockReturnValue({
      isActive: true,
      isRailDragging: false,
    });

    render(
      <MarketPreviewCard
        href="/listing/1"
        imageUrl="https://example.com/video.mp4"
        posterUrl="https://example.com/poster.jpg"
        title="Hilux"
        price={120000}
        city="Richards Bay"
        provinceCode="KZN"
      />
    );

    expect(screen.getByTestId("poster-card-shell")).toBeInTheDocument();
    expect(posterCardSpy.mock.calls[0]?.[0]).toMatchObject({
      feedPlaybackActive: true,
    });
  });

  it("disables feed playback when the rail item is off-focus or dragging", () => {
    railStateSpy.mockReturnValue({
      isActive: false,
      isRailDragging: true,
    });

    render(
      <MarketPreviewCard
        href="/listing/2"
        imageUrl="https://example.com/video.mp4"
        posterUrl="https://example.com/poster.jpg"
        title="Corolla"
        price={90000}
        city="Durban"
        provinceCode="KZN"
      />
    );

    expect(posterCardSpy.mock.calls[0]?.[0]).toMatchObject({
      feedPlaybackActive: false,
    });
  });

  it("disables native browser dragging for homepage rail cards", () => {
    railStateSpy.mockReturnValue({
      isActive: true,
      isRailDragging: false,
    });

    render(
      <MarketPreviewCard
        href="/listing/3"
        imageUrl="https://example.com/poster.jpg"
        title="Civic"
        price={110000}
        city="Johannesburg"
        provinceCode="GP"
      />
    );

    expect(posterCardSpy.mock.calls[0]?.[0]).toMatchObject({
      disableNativeDrag: true,
    });
  });
});
