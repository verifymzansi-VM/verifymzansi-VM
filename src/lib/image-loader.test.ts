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

  it("maps media proxy images to the nearest pre-generated variant key", async () => {
    vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", "true");
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

  it("leaves media proxy videos on the original key", async () => {
    vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", "true");
    const { default: loader } = await import("./image-loader");
    const result = loader({ src: "/api/media/serve/media/listing/clip.mp4", width: 512 });
    expect(result).toBe("/api/media/serve/media/listing/clip.mp4");
  });

  it("transforms known media host absolute URLs via /cdn-cgi/image/ when resizing enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", "true");
    const { default: loader } = await import("./image-loader");
    const result = loader({ src: "https://media.verifymzansi.com/photos/hero.jpg", width: 768 });
    expect(result).toBe("/cdn-cgi/image/width=768,quality=75,format=auto/photos/hero.jpg");
  });

  it("transforms known staging media host absolute URLs via /cdn-cgi/image/ when resizing enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", "true");
    const { default: loader } = await import("./image-loader");
    const result = loader({
      src: "https://media-staging.verifymzansi.com/photos/hero.jpg",
      width: 640,
      quality: 80,
    });
    expect(result).toBe("/cdn-cgi/image/width=640,quality=80,format=auto/photos/hero.jpg");
  });
});
