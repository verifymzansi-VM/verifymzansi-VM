import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessPreviewCard } from "./business-preview-card";

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

describe("BusinessPreviewCard", () => {
  beforeEach(() => {
    posterCardSpy.mockClear();
    railStateSpy.mockReset();
  });

  it("enables native-drag suppression for homepage business rail cards", () => {
    railStateSpy.mockReturnValue({
      isActive: true,
      isRailDragging: false,
    });

    render(
      <BusinessPreviewCard
        id="business-1"
        href="/mzansi-business/business-1"
        imageUrl="https://example.com/poster.jpg"
        title="Nomsa Fashion"
        businessType="mall_store"
        city="Johannesburg"
        provinceCode="GP"
      />
    );

    expect(screen.getByTestId("poster-card-shell")).toBeInTheDocument();
    expect(posterCardSpy.mock.calls[0]?.[0]).toMatchObject({
      disableNativeDrag: true,
      feedPlaybackActive: true,
    });
  });
});
