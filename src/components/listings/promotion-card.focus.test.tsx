import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PromotionCard } from "./promotion-card";

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

describe("PromotionCard rail focus playback", () => {
  beforeEach(() => {
    posterCardSpy.mockClear();
    railStateSpy.mockReset();
  });

  it("passes the rail-focused playback gate into the shared poster card shell", () => {
    railStateSpy.mockReturnValue({
      isActive: false,
      isRailDragging: true,
    });

    render(
      <PromotionCard
        id="promo-1"
        title="Food Festival"
        price={5000}
        imageUrl="https://example.com/promo.mp4"
        posterUrl="https://example.com/promo.jpg"
        province="Gauteng"
        city="Johannesburg"
        promotionType="event"
        createdAt="2026-04-14T10:00:00.000Z"
      />
    );

    expect(posterCardSpy.mock.calls[0]?.[0]).toMatchObject({
      feedPlaybackActive: false,
    });
  });
});
