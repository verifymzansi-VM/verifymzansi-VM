/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { AreaPreviewCard } from "./area-preview-card";

const { videoCardPlayerMock } = vi.hoisted(() => ({
  videoCardPlayerMock: vi.fn(
    ({ src, posterUrl, mode }: { src: string; posterUrl?: string; mode?: string }) => (
      <div
        data-testid="video-card-player"
        data-src={src}
        data-poster={posterUrl ?? ""}
        data-mode={mode ?? ""}
      />
    )
  ),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  default: ({ src, alt, ...props }: { src: string; alt: string; [key: string]: unknown }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} {...props} />
  ),
}));

vi.mock("@/components/ui/video-card-player", () => ({
  VideoCardPlayer: videoCardPlayerMock,
  isVideoUrl: (url: string | undefined) => Boolean(url?.endsWith(".mp4")),
}));

describe("AreaPreviewCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes ambient mode to VideoCardPlayer for video media", () => {
    render(
      <AreaPreviewCard
        href="/areas/gp"
        imageUrl="https://example.com/preview.mp4"
        posterUrl="https://example.com/preview.jpg"
        title="Soweto Highlights"
        city="Johannesburg"
        provinceCode="GP"
      />
    );

    const player = screen.getByTestId("video-card-player");
    expect(player).toHaveAttribute("data-src", "https://example.com/preview.mp4");
    expect(player).toHaveAttribute("data-poster", "https://example.com/preview.jpg");
    expect(player).toHaveAttribute("data-mode", "ambient");
  });
});
