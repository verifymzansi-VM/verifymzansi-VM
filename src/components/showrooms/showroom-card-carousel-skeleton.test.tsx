import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShowroomCardCarouselSkeleton } from "./showroom-card-carousel-skeleton";

describe("ShowroomCardCarouselSkeleton", () => {
  it("matches the live showroom section spacing to avoid layout shift", () => {
    const { container } = render(<ShowroomCardCarouselSkeleton />);
    const section = container.querySelector("section");

    expect(section).not.toBeNull();
    expect(section?.className).toContain("pt-0");
    expect(section?.className).toContain("sm:pt-0");
    expect(section?.className).toContain("pb-8");
    expect(section?.className).toContain("sm:pb-10");
    expect(section?.className).toContain("lg:min-h-[clamp(31rem,64vh,42rem)]");
    expect(section?.className).toContain("lg:py-10");
    expect(screen.getAllByLabelText("Loading").length).toBeGreaterThan(0);
  });

  it("sizes skeleton cards with the shared showroom card frame", () => {
    const { container } = render(<ShowroomCardCarouselSkeleton />);
    const sizedCards = Array.from(container.querySelectorAll(".showroom-card-frame"));

    expect(sizedCards.length).toBeGreaterThanOrEqual(3);
  });
});
