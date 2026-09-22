import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import HomeLoading from "@/app/loading";
import { HeroBannerSkeleton } from "./hero-banner-skeleton";
import { generatedMzansiShowroomBackground } from "@/components/showrooms/showroom-backgrounds";

vi.mock("@/components/layout/header", () => ({
  Header: () => <header>VerifyMzansi</header>,
}));

describe("homepage loading background", () => {
  it.each([
    ["route fallback", HomeLoading],
    ["hero data fallback", HeroBannerSkeleton],
  ] as const)("renders the showroom artwork in the %s before data arrives", (_, Loading) => {
    const { container } = render(<Loading />);
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
