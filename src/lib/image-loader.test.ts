import { describe, it, expect, vi, beforeEach } from "vitest";

describe("cloudflareImageLoader", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns src unchanged when CF_IMAGE_RESIZING is disabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", "false");
    const { default: loader } = await import("./image-loader");
    expect(loader({ src: "/hero.jpg", width: 800 })).toBe("/hero.jpg");
  });

  it("returns absolute remote URLs unchanged when resizing is enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", "true");
    const { default: loader } = await import("./image-loader");
    const result = loader({
      src: "https://images.unsplash.com/photo-example",
      width: 640,
      quality: 80,
    });
    expect(result).toBe("https://images.unsplash.com/photo-example");
  });

  it("keeps static relative URLs unchanged when resizing is enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", "true");
    const { default: loader } = await import("./image-loader");
    const result = loader({ src: "/images/hero.jpg", width: 1024 });
    expect(result).toBe("/images/hero.jpg");
  });

  it("transforms media proxy paths via /cdn-cgi/image/ when resizing is enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", "true");
    const { default: loader } = await import("./image-loader");
    const result = loader({ src: "/api/media/serve/media/listing/hero.jpg", width: 512 });
    expect(result).toBe(
      "/cdn-cgi/image/width=512,quality=75,format=auto/api/media/serve/media/listing/hero.jpg"
    );
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
