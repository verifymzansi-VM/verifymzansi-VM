import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShowroomCardCarouselSkeleton } from "./showroom-card-carousel-skeleton";

describe("ShowroomCardCarouselSkeleton", () => {
  it("uses fixed desktop viewport height while removing mobile top spacing", () => {
    const { container } = render(<ShowroomCardCarouselSkeleton />);
    const section = container.querySelector("section");

    expect(section).not.toBeNull();
    expect(section?.className).toContain("pt-0");
    expect(section?.className).toContain("sm:pt-0");
    expect(section?.className).toContain("pb-1");
    expect(section?.className).toContain("sm:pb-3");
    expect(section?.className).toContain("lg:h-[calc(100svh-4rem)]");
    expect(section?.className).toContain("lg:py-0");
    expect(screen.getAllByLabelText("Loading").length).toBeGreaterThan(0);
  });

  it("matches the reduced desktop showroom widths in the skeleton cards", () => {
    const { container } = render(<ShowroomCardCarouselSkeleton />);
    const sizedCards = Array.from(container.querySelectorAll("section > div > div"));

    expect(sizedCards.some((node) => node.className.includes("w-[72vw]"))).toBe(true);
    expect(sizedCards.some((node) => node.className.includes("lg:w-[292px]"))).toBe(true);
    expect(sizedCards.some((node) => node.className.includes("xl:w-[320px]"))).toBe(true);
  });
});
