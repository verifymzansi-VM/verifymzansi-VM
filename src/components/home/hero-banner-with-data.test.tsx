import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HeroBannerWithData } from "./hero-banner-with-data";

const { mockLoadShowroomItems, showroomCarouselMock } = vi.hoisted(() => ({
  mockLoadShowroomItems: vi.fn(),
  showroomCarouselMock: vi.fn(({ items }: { items: Array<{ title: string }> }) => (
    <div data-testid="hero-showroom" data-count={items.length}>
      {items.map((item) => (
        <span key={item.title}>{item.title}</span>
      ))}
    </div>
  )),
}));

vi.mock("@/lib/showroom/feed", () => ({ loadShowroomItems: mockLoadShowroomItems }));
vi.mock("@/components/showrooms/showroom-card-carousel", () => ({
  ShowroomCardCarousel: showroomCarouselMock,
}));

describe("HeroBannerWithData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the home showroom", async () => {
    mockLoadShowroomItems.mockResolvedValue([
      { id: "b1", type: "business", href: "/mzansi-business/b1", title: "Local business" },
      { id: "l1", type: "listing", href: "/listing/l1", title: "National listing" },
    ]);

    render(await HeroBannerWithData());

    expect(mockLoadShowroomItems).toHaveBeenCalledWith("home");
    expect(screen.getByTestId("hero-showroom")).toHaveAttribute("data-count", "2");
    expect(showroomCarouselMock).toHaveBeenCalledWith(
      expect.objectContaining({ surface: "showroom:home" }),
      undefined
    );
  });

  it("passes the New tag of a new post to its card", async () => {
    const fresh = {
      id: "l2",
      type: "listing",
      href: "/listing/l2",
      title: "Fresh listing",
      statusLabel: "New",
      statusClassName: "bg-brand-gold-300 text-brand-green-900",
    };
    mockLoadShowroomItems.mockResolvedValue([fresh]);

    render(await HeroBannerWithData());

    expect(showroomCarouselMock).toHaveBeenCalledWith(
      expect.objectContaining({ items: [fresh] }),
      undefined
    );
  });
});
