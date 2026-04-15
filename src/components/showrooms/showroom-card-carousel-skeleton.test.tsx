import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShowroomCardCarouselSkeleton } from "./showroom-card-carousel-skeleton";

describe("ShowroomCardCarouselSkeleton", () => {
  it("removes desktop top padding while keeping bottom spacing", () => {
    const { container } = render(<ShowroomCardCarouselSkeleton />);
    const section = container.querySelector("section");

    expect(section).not.toBeNull();
    expect(section?.className).toContain("pt-6");
    expect(section?.className).toContain("sm:pt-8");
    expect(section?.className).toContain("lg:pt-0");
    expect(section?.className).toContain("pb-6");
    expect(section?.className).toContain("sm:pb-8");
    expect(section?.className).toContain("lg:pb-10");
    expect(screen.getAllByLabelText("Loading").length).toBeGreaterThan(0);
  });
});
