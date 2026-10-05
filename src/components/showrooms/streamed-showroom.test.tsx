import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StreamedShowroom } from "./streamed-showroom";
import { mzansiMarketShowroomBackground } from "./showroom-backgrounds";

vi.mock("@/lib/showroom/feed", () => ({
  loadShowroomItems: () => new Promise(() => {}),
}));

describe("StreamedShowroom", () => {
  it("paints the area artwork while the showroom feed is still loading", () => {
    const { container } = render(
      <StreamedShowroom
        feed="market"
        surface="showroom:market"
        hideFixtures={false}
        emptyTitle="Mzansi Market"
        emptyDescription="Listings"
        background={mzansiMarketShowroomBackground}
      />
    );

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(
      container.querySelector('[data-showroom-background="responsive"]')?.getAttribute("src")
    ).toBe(mzansiMarketShowroomBackground.mobileSrc);
  });
});
