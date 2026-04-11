/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";

const videoCardPlayerMock = vi.fn(
  ({
    src,
    mode,
    fitStrategy,
    muteControlVisibility,
  }: {
    src: string;
    mode?: string;
    fitStrategy?: string;
    muteControlVisibility?: string;
  }) => (
    <div
      data-testid="video-card-player"
      data-src={src}
      data-mode={mode}
      data-fit-strategy={fitStrategy}
      data-mute-control={muteControlVisibility}
    />
  )
);

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
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

vi.mock("@/components/ui/card", () => ({
  Card: ({
    children,
    trustLevel: _trustLevel,
    ...props
  }: {
    children: React.ReactNode;
    trustLevel?: unknown;
    [key: string]: unknown;
  }) => (
    <div data-testid="card" {...props}>
      {children}
    </div>
  ),
}));

vi.mock("@/components/ui/video-card-player", () => ({
  VideoCardPlayer: videoCardPlayerMock,
  isVideoUrl: (url: string | null | undefined) => Boolean(url?.endsWith(".mp4")),
}));

const { BusinessCard } = await import("@/components/listings/business-card");

describe("BusinessCard", () => {
  const defaultProps = {
    id: "business-1",
    businessName: "Nomsa Fashion",
    businessType: "standalone_shop" as const,
    coverPhoto: "https://example.com/cover.jpg",
    province: "Gauteng",
    city: "Johannesburg",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders only the simplified overlay content", () => {
    render(
      <BusinessCard
        {...defaultProps}
        category="fashion_accessories"
        subcategory="clothing_store"
        description="Tailored clothing and occasionwear"
        featuredUntil="2099-01-02T00:00:00.000Z"
      />
    );

    expect(screen.getByText("Nomsa Fashion")).toBeTruthy();
    // Card shows subcategory label + business type label
    expect(screen.getByText(/Clothing Store/i)).toBeTruthy();
    expect(screen.getByText(/Own Premises/i)).toBeTruthy();
    expect(screen.getByText(/Johannesburg/i)).toBeTruthy();
    expect(screen.getByText("Featured")).toBeTruthy();
  });

  it("shows the business logo when provided", () => {
    render(<BusinessCard {...defaultProps} logoUrl="https://example.com/logo.jpg" />);

    expect(screen.getByAltText("Nomsa Fashion logo")).toHaveAttribute(
      "src",
      "https://example.com/logo.jpg"
    );
  });

  it("uses the shared smart-fit video player when cover video is available", () => {
    render(
      <BusinessCard
        {...defaultProps}
        coverVideo="https://example.com/cover.mp4"
        videoThumbnail="https://example.com/thumb.jpg"
      />
    );

    expect(screen.getByTestId("video-card-player")).toHaveAttribute(
      "data-src",
      "https://example.com/cover.mp4"
    );
    expect(screen.getByTestId("video-card-player")).toHaveAttribute("data-mode", "ambient");
    expect(screen.getByTestId("video-card-player")).toHaveAttribute("data-fit-strategy", "smart");
    expect(screen.getByTestId("video-card-player")).toHaveAttribute("data-mute-control", "auto");
  });

  it("links directly to the business detail page", () => {
    render(<BusinessCard {...defaultProps} />);

    expect(screen.getByRole("link")).toHaveAttribute("href", "/mzansi-business/business-1");
  });
});
