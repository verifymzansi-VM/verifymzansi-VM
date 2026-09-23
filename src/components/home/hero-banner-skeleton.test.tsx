import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import GlobalLoading from "@/app/loading";
import { HeroBannerSkeleton } from "./hero-banner-skeleton";
import { generatedMzansiShowroomBackground } from "@/components/showrooms/showroom-backgrounds";

describe("homepage loading background", () => {
  it("keeps showroom artwork out of the shared route fallback", () => {
    const { container } = render(<GlobalLoading />);

    expect(container.querySelector("[data-showroom-background]")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders showroom artwork in the homepage hero data fallback", () => {
    const { container } = render(<HeroBannerSkeleton />);
    const background = container.querySelector<HTMLImageElement>("[data-showroom-background]");

    expect(background).not.toBeNull();
    expect(decodeURIComponent(background?.getAttribute("src") ?? "")).toContain(
      generatedMzansiShowroomBackground.src
    );
    expect(background?.closest("section")).toHaveClass("showroom-viewport");
    expect(background?.style.objectPosition).toBe("center 48%");
    expect(background?.style.filter).toContain("blur(0px)");
    expect(background?.getAttribute("loading")).not.toBe("lazy");
    expect(container.querySelector(".aspect-\\[21\\/9\\]")).toBeNull();
  });
});
