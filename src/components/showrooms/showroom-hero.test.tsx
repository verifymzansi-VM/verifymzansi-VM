import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ShowroomHero } from "./showroom-hero";

const { videoCardPlayerMock } = vi.hoisted(() => ({
  videoCardPlayerMock: vi.fn(
    ({ alt, muteControlVisibility }: { alt?: string; muteControlVisibility?: string }) => (
      <div data-testid="showroom-media" data-mute-control={muteControlVisibility}>
        {alt}
      </div>
    )
  ),
}));

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

vi.mock("@/components/ui/video-card-player", () => ({
  VideoCardPlayer: videoCardPlayerMock,
}));

describe("ShowroomHero", () => {
  it("uses /listing/:id for listing CTA links", async () => {
    render(
      <ShowroomHero
        slides={[
          {
            id: "listing-1",
            type: "listing",
            title: "Verified Phone",
            description: "Great condition",
            location: "Cape Town",
            mediaUrl: "https://example.com/photo.jpg",
          },
        ]}
      />
    );

    await waitFor(() => {
      const ctas = screen.getAllByRole("link", { name: /view listing/i });
      expect(ctas.some((link) => link.getAttribute("href") === "/listing/listing-1")).toBe(true);
    });
  });

  it("routes storefront type to /mzansi-business/", async () => {
    render(
      <ShowroomHero
        slides={[
          {
            id: "store-1",
            type: "storefront",
            title: "Mall Store",
            description: "New arrivals",
            location: "Sandton",
            mediaUrl: "https://example.com/store.jpg",
          },
        ]}
      />
    );

    await waitFor(() => {
      const ctas = screen.getAllByRole("link", { name: /visit shop/i });
      expect(ctas.some((link) => link.getAttribute("href") === "/mzansi-business/store-1")).toBe(
        true
      );
    });
  });

  it("prefers slide CTA overrides when provided", async () => {
    render(
      <ShowroomHero
        slides={[
          {
            id: "business-empty",
            type: "business",
            title: "Mzansi Business",
            description: "Discover verified South African businesses and services.",
            location: "South Africa",
            mediaUrl: "/images/fallbacks/hero-shop.svg",
            hrefOverride: "/post/create-business",
            ctaLabelOverride: "List Your Business",
            badgeLabelOverride: "Mzansi Business",
          },
        ]}
      />
    );

    await waitFor(() => {
      const ctas = screen.getAllByRole("link", { name: /list your business/i });
      expect(ctas.some((link) => link.getAttribute("href") === "/post/create-business")).toBe(true);
    });

    expect(screen.getAllByText("Mzansi Business").length).toBeGreaterThan(0);
  });

  it("renders placeholder content when slides are empty", async () => {
    render(<ShowroomHero slides={[]} />);

    await waitFor(() => {
      expect(screen.getAllByText("Welcome to VerifyMzansi Showroom").length).toBeGreaterThan(0);
    });
  });

  it("keeps the mute control visible on showroom media", () => {
    render(
      <ShowroomHero
        slides={[
          {
            id: "listing-1",
            type: "listing",
            title: "Verified Phone",
            description: "Great condition",
            location: "Cape Town",
            mediaUrl: "https://example.com/video.mp4",
            posterUrl: "https://example.com/poster.jpg",
          },
        ]}
      />
    );

    expect(screen.getByTestId("showroom-media")).toHaveAttribute("data-mute-control", "always");
  });
});
