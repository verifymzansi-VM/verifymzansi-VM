/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    fill: _fill,
    sizes: _sizes,
    priority: _priority,
    unoptimized: _unoptimized,
    ...props
  }: Record<string, unknown> & { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} {...props} />
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/video-with-poster", () => ({
  VideoWithPoster: ({
    src,
    posterUrl,
    className,
    wrapperClassName,
  }: {
    src: string;
    posterUrl?: string;
    className?: string;
    wrapperClassName?: string;
  }) => (
    <div
      data-testid="video-with-poster"
      data-src={src}
      data-poster-url={posterUrl}
      data-class-name={className}
      data-wrapper-class-name={wrapperClassName}
    />
  ),
}));

vi.mock("@/contexts/video-playback-context", () => ({
  useVideoPlaybackManager: () => ({
    register: vi.fn(),
    unregister: vi.fn(),
    updateVisibility: vi.fn(),
    requestPriority: vi.fn(),
    releasePriority: vi.fn(),
    claimExclusive: vi.fn(),
    releaseExclusive: vi.fn(),
  }),
}));

const { ListingDetailClient } = await import("@/app/listing/[id]/client");

describe("ListingDetailClient", () => {
  it("opens on the first video when photos and videos are both present", () => {
    render(
      <ListingDetailClient
        photos={["https://example.com/photo-1.jpg", "https://example.com/photo-2.jpg"]}
        videos={["https://example.com/video-1.mp4"]}
        title="Toyota Hilux 2019"
        listingId="listing-1"
        videoThumbnail="https://example.com/video-thumb.jpg"
      />
    );

    expect(screen.getByLabelText("Toyota Hilux 2019 video")).toHaveAttribute(
      "src",
      "https://example.com/video-1.mp4"
    );

    const thumbnails = screen.getAllByRole("button");
    expect(
      thumbnails.some((button) => button.getAttribute("aria-label") === "View video 1 of 3")
    ).toBe(true);
  });

  it("keeps photo-only listings photo-first", () => {
    render(
      <ListingDetailClient
        photos={["https://example.com/photo-1.jpg", "https://example.com/photo-2.jpg"]}
        videos={[]}
        title="Photo Listing"
        listingId="listing-2"
      />
    );

    expect(screen.getByAltText("Photo Listing - photo 1")).toHaveAttribute(
      "src",
      "https://example.com/photo-1.jpg"
    );
    expect(screen.queryByTestId("video-with-poster")).toBeNull();
  });

  it("renders video-only listings correctly", () => {
    render(
      <ListingDetailClient
        photos={[]}
        videos={["https://example.com/video-only.mp4"]}
        title="Video Listing"
        listingId="listing-3"
      />
    );

    expect(screen.getByLabelText("Video Listing video")).toHaveAttribute(
      "src",
      "https://example.com/video-only.mp4"
    );
  });

  it("uses photoCount to keep blob preview videos classified after reordering", () => {
    render(
      <ListingDetailClient
        photos={["blob:http://localhost/photo-preview"]}
        videos={["blob:http://localhost/video-preview"]}
        title="Preview Listing"
        listingId="listing-4"
        photoCount={1}
      />
    );

    expect(screen.getByLabelText("Preview Listing video")).toHaveAttribute(
      "src",
      "blob:http://localhost/video-preview"
    );
    expect(screen.getByRole("button", { name: "View video 1 of 2" })).toBeTruthy();
  });

  it("renders blob photo previews in the main image area", () => {
    render(
      <ListingDetailClient
        photos={["blob:http://localhost/photo-preview"]}
        videos={[]}
        title="Blob Photo Listing"
        listingId="listing-5"
      />
    );

    expect(screen.getByAltText("Blob Photo Listing - photo 1")).toHaveAttribute(
      "src",
      "blob:http://localhost/photo-preview"
    );
  });

  it("shows a fallback when active media URL is blank-like", () => {
    render(
      <ListingDetailClient
        photos={["   "]}
        videos={[]}
        title="Invalid Media Listing"
        listingId="listing-6"
      />
    );

    expect(screen.getByText("Media could not load")).toBeTruthy();
  });

  it("swipes between hero media items on touch devices", () => {
    render(
      <ListingDetailClient
        photos={["https://example.com/photo-1.jpg"]}
        videos={["https://example.com/video-1.mp4"]}
        title="Swipe Ready Listing"
        listingId="listing-7"
        videoThumbnail="https://example.com/video-thumb.jpg"
      />
    );

    const heroVideo = screen.getByLabelText("Swipe Ready Listing video");
    fireEvent.touchStart(heroVideo, {
      touches: [{ clientX: 260, clientY: 200 }],
    });
    fireEvent.touchEnd(heroVideo, {
      changedTouches: [{ clientX: 120, clientY: 210 }],
    });

    expect(screen.getByAltText("Swipe Ready Listing - photo 2")).toHaveAttribute(
      "src",
      "https://example.com/photo-1.jpg"
    );
  });
});
