import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HeroBannerWithData } from "./hero-banner-with-data";

const { mockLoadShowroomItems, mockGetVisitorProvince, showroomCarouselMock } = vi.hoisted(() => ({
  mockLoadShowroomItems: vi.fn(),
  mockGetVisitorProvince: vi.fn(),
  showroomCarouselMock: vi.fn(({ items }: { items: Array<{ title: string }> }) => (
    <div data-testid="hero-showroom" data-count={items.length}>
      {items.map((item) => (
        <span key={item.title}>{item.title}</span>
      ))}
    </div>
  )),
}));

vi.mock("@/lib/showroom/feed", () => ({ loadShowroomItems: mockLoadShowroomItems }));
vi.mock("@/lib/showroom/visitor-province", () => ({ getVisitorProvince: mockGetVisitorProvince }));
vi.mock("@/components/showrooms/showroom-card-carousel", () => ({
  ShowroomCardCarousel: showroomCarouselMock,
}));

describe("HeroBannerWithData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the home showroom in fair rotation order for the visitor's province", async () => {
    const visitor = { province: "Gauteng", source: "detected" as const };
    mockGetVisitorProvince.mockResolvedValue(visitor);
    mockLoadShowroomItems.mockResolvedValue([
      { id: "b1", type: "business", href: "/mzansi-business/b1", title: "Local business" },
      { id: "l1", type: "listing", href: "/listing/l1", title: "National listing" },
    ]);

    render(await HeroBannerWithData());

    expect(mockLoadShowroomItems).toHaveBeenCalledWith("home", { province: "Gauteng" });
    expect(screen.getByTestId("hero-showroom")).toHaveAttribute("data-count", "2");
    expect(showroomCarouselMock).toHaveBeenCalledWith(
      expect.objectContaining({ surface: "showroom:home", visitorProvince: visitor }),
      undefined
    );
  });
});
