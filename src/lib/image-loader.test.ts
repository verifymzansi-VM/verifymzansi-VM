import { describe, it, expect, vi, beforeEach } from "vitest";

describe("cloudflareImageLoader", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("adds width/quality query params when CF_IMAGE_RESIZING is disabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", "false");
    const { default: loader } = await import("./image-loader");
    expect(loader({ src: "/hero.jpg", width: 800 })).toBe("/hero.jpg?w=800&q=75");
  });

  it("keeps absolute remote URLs as pass-through with width/quality query params", async () => {
    vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", "true");
    const { default: loader } = await import("./image-loader");
    const result = loader({
      src: "https://images.unsplash.com/photo-example",
      width: 640,
      quality: 80,
    });
    expect(result).toBe("https://images.unsplash.com/photo-example?w=640&q=80");
  });

  it("keeps static relative URLs as pass-through with width/quality query params", async () => {
    vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", "true");
    const { default: loader } = await import("./image-loader");
    const result = loader({ src: "/images/hero.jpg", width: 1024 });
    expect(result).toBe("/images/hero.jpg?w=1024&q=75");
  });

  it("maps media proxy images to pre-generated variants even when Cloudflare resizing is disabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", "false");
    const { default: loader } = await import("./image-loader");
    // 512 requested → nearest variant >= 512 is 800
    const result = loader({ src: "/api/media/serve/media/listing/hero.jpg", width: 512 });
    expect(result).toBe("/api/media/serve/media/listing/hero.w800.webp");
  });

  it("maps small requests to the 400w variant", async () => {
    vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", "true");
    const { default: loader } = await import("./image-loader");
    const result = loader({ src: "/api/media/serve/media/listing/hero.jpg", width: 320 });
    expect(result).toBe("/api/media/serve/media/listing/hero.w400.webp");
  });

  it("caps large requests at the 1600w variant", async () => {
    vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", "true");
    const { default: loader } = await import("./image-loader");
    const result = loader({ src: "/api/media/serve/media/listing/hero.jpg", width: 2400 });
    expect(result).toBe("/api/media/serve/media/listing/hero.w1600.webp");
  });

  it("does not double-rewrite an existing variant key", async () => {
    vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", "true");
    const { default: loader } = await import("./image-loader");
    const result = loader({ src: "/api/media/serve/media/listing/hero.w800.webp", width: 512 });
    expect(result).toBe("/api/media/serve/media/listing/hero.w800.webp");
  });

  it.each([
    [128, 800],
    [320, 800],
    [400, 800],
    [640, 800],
    [1080, 1600],
    [3840, 1600],
  ])(
    "maps a live-backend key (no extension) at %i px to its %i px copy",
    async (width, variant) => {
      vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", "true");
      const { default: loader } = await import("./image-loader");
      const key = "media/0f6c2a8e-1b7d-4e0a-9a51-3c2d9e7b1a01";
      expect(loader({ src: `/api/media/serve/${key}`, width })).toBe(
        `/api/media/serve/${key}.w${variant}.webp`
      );
      expect(loader({ src: `https://verifymzansi.com/api/media/serve/${key}`, width })).toBe(
        `/api/media/serve/${key}.w${variant}.webp`
      );
    }
  );

  it("leaves other extensionless media proxy paths unchanged", async () => {
    vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", "true");
    const { default: loader } = await import("./image-loader");
    expect(loader({ src: "/api/media/serve/media/listing/clip", width: 400 })).toBe(
      "/api/media/serve/media/listing/clip"
    );
    expect(
      loader({ src: "/api/media/serve/listings/0f6c2a8e-1b7d-4e0a-9a51-3c2d9e7b1a01", width: 400 })
    ).toBe("/api/media/serve/listings/0f6c2a8e-1b7d-4e0a-9a51-3c2d9e7b1a01");
  });

  it("leaves media proxy videos on the original key", async () => {
    vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", "false");
    const { default: loader } = await import("./image-loader");
    const result = loader({ src: "/api/media/serve/media/listing/clip.mp4", width: 512 });
    expect(result).toBe("/api/media/serve/media/listing/clip.mp4");
  });

  it("maps absolute same-origin media proxy URLs without Cloudflare resizing", async () => {
    vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", "false");
    const { default: loader } = await import("./image-loader");
    expect(
      loader({ src: "https://verifymzansi.com/api/media/serve/media/listing/hero.jpg", width: 320 })
    ).toBe("/api/media/serve/media/listing/hero.w400.webp");
  });

  // The zone has no Cloudflare Image Resizing: a /cdn-cgi/image/ path on this
  // site would not exist, so media host URLs keep their own address.
  it("keeps media host absolute URLs on the media host", async () => {
    vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", "true");
    const { default: loader } = await import("./image-loader");
    const result = loader({ src: "https://media.verifymzansi.com/photos/hero.jpg", width: 768 });
    expect(result).toBe("https://media.verifymzansi.com/photos/hero.jpg?w=768&q=75");
    expect(result).not.toContain("/cdn-cgi/");
  });

  it("keeps staging media host absolute URLs on the staging media host", async () => {
    vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", "true");
    const { default: loader } = await import("./image-loader");
    const result = loader({
      src: "https://media-staging.verifymzansi.com/photos/hero.jpg",
      width: 640,
      quality: 80,
    });
    expect(result).toBe("https://media-staging.verifymzansi.com/photos/hero.jpg?w=640&q=80");
  });

  it("leaves same-origin paths without an image extension unchanged in production", async () => {
    vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", "true");
    const { default: loader } = await import("./image-loader");
    expect(loader({ src: "/api/og/card", width: 400 })).toBe("/api/og/card");
  });

  it("adds width and quality to every same-origin path when the setting is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", "false");
    const { default: loader } = await import("./image-loader");
    expect(loader({ src: "/api/og/card", width: 400 })).toBe("/api/og/card?w=400&q=75");
  });

  it("keeps existing query parameters and the hash when adding width and quality", async () => {
    vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", "true");
    const { default: loader } = await import("./image-loader");
    expect(loader({ src: "/images/logo.png?fit=cover#hero", width: 320, quality: 80 })).toBe(
      "/images/logo.png?fit=cover&w=320&q=80#hero"
    );
    expect(
      loader({ src: "https://images.unsplash.com/photo-123?auto=format#preview", width: 640 })
    ).toBe("https://images.unsplash.com/photo-123?auto=format&w=640&q=75#preview");
  });
});
