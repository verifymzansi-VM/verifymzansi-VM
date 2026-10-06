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
      />
    );

    expect(screen.getByText("Nomsa Fashion")).toBeTruthy();
    // Immersive cards keep only the title and location overlay.
    expect(screen.queryByText(/Clothing Store/i)).toBeNull();
    expect(screen.queryByText(/Own Premises/i)).toBeNull();
    expect(screen.getByText(/Johannesburg/i)).toBeTruthy();
    expect(screen.queryByText("Featured")).toBeNull();
  });

  it("shows the business logo when provided", () => {
    render(<BusinessCard {...defaultProps} logoUrl="https://example.com/logo.jpg" />);

    expect(screen.getByAltText("Nomsa Fashion logo")).toHaveAttribute(
      "src",
      "https://example.com/logo.jpg"
    );
  });

  it("uses the shared cover-fit video player when video is available", () => {
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
    expect(screen.getByTestId("video-card-player")).toHaveAttribute("data-mode", "hover");
    expect(screen.getByTestId("video-card-player")).toHaveAttribute("data-fit-strategy", "smart");
    expect(screen.getByTestId("video-card-player")).toHaveAttribute("data-mute-control", "always");
  });

  it("links directly to the business detail page", () => {
    render(<BusinessCard {...defaultProps} />);

    expect(screen.getByRole("link")).toHaveAttribute("href", "/mzansi-business/business-1");
  });

  it("shows the CIPC and Seen stickers on the card image", () => {
    render(
      <BusinessCard
        {...defaultProps}
        stickers={{
          idReviewed: false,
          cipcCheckedAt: "2026-10-01T10:00:00.000Z",
          seenAt: "2026-10-02T10:00:00.000Z",
          seenMethod: "video",
        }}
      />
    );
    const stickers = screen.getByRole("list", { name: "Verification" });
    expect(stickers.closest("[data-card-overlay]")).not.toBeNull();
    expect(screen.getByText(/CIPC registered · checked/)).toBeInTheDocument();
    expect(screen.getByText(/Seen on live video/)).toBeInTheDocument();
  });

  it("shows no stickers when the business holds none", () => {
    render(<BusinessCard {...defaultProps} stickers={{ idReviewed: false }} />);
    expect(screen.queryByRole("list", { name: "Verification" })).toBeNull();
  });
});
