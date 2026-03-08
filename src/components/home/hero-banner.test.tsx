/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HeroBanner } from "./hero-banner";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    fill: _fill,
    sizes: _sizes,
    priority: _priority,
    ...props
  }: Record<string, unknown> & { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} {...props} />
  ),
}));

vi.mock("@/hooks/use-video-visibility", () => ({
  useVideoVisibility: () => ({ videoRef: { current: null }, reducedMotion: false }),
}));

vi.mock("./promo-video-slide", () => ({
  PromoVideoSlide: () => <div data-testid="promo-video-slide" />,
}));

describe("HeroBanner", () => {
  it("renders text-only category links instead of the search bar", () => {
    render(
      <HeroBanner
        latestListings={[
          {
            id: "listing-1",
            title: "Honda Fit",
            description: "Clean hatchback",
            location_city: "Johannesburg",
            photos: ["/images/fallbacks/hero-listing.svg"],
          },
        ]}
      />
    );

    expect(screen.getByRole("navigation", { name: "Marketplace categories" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mzansi Market" })).toHaveAttribute(
      "href",
      "/mzansi-market"
    );
    expect(screen.getByRole("link", { name: "Mzansi Business" })).toHaveAttribute(
      "href",
      "/mzansi-business"
    );
    expect(screen.getByRole("link", { name: "Promotions & Events" })).toHaveAttribute(
      "href",
      "/promotions"
    );
    expect(screen.queryByRole("button", { name: "Search" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Search area")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Search listings")).not.toBeInTheDocument();
  });
});
