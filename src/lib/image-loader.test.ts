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

  it("transforms absolute URLs via /cdn-cgi/image/ when resizing enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", "true");
    const { default: loader } = await import("./image-loader");
    const result = loader({
      src: "https://media.verifymzansi.com/img.jpg",
      width: 640,
      quality: 80,
    });
    expect(result).toBe(
      "/cdn-cgi/image/width=640,quality=80,format=auto/https://media.verifymzansi.com/img.jpg"
    );
  });

  it("transforms relative URLs via /cdn-cgi/image/ when resizing enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", "true");
    const { default: loader } = await import("./image-loader");
    const result = loader({ src: "/images/hero.jpg", width: 1024 });
    expect(result).toBe("/cdn-cgi/image/width=1024,quality=75,format=auto/images/hero.jpg");
  });
});
