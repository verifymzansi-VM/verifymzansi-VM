import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShowroomCardCarouselSkeleton } from "./showroom-card-carousel-skeleton";

describe("ShowroomCardCarouselSkeleton", () => {
  it("matches the live showroom section spacing to avoid layout shift", () => {
    const { container } = render(<ShowroomCardCarouselSkeleton />);
    const section = container.querySelector("section");

    expect(section).not.toBeNull();
    expect(section?.className).toContain("showroom-viewport");
    expect(screen.getAllByLabelText("Loading").length).toBeGreaterThan(0);
  });

  it("sizes skeleton cards with the shared showroom card frame", () => {
    const { container } = render(<ShowroomCardCarouselSkeleton />);
    const sizedCards = Array.from(container.querySelectorAll(".showroom-card-frame"));

    expect(sizedCards.length).toBeGreaterThanOrEqual(3);
  });
});
