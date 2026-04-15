import { describe, it, expect, vi, beforeEach } from "vitest";

describe("cloudflareImageLoader", () => {
  const PROXY = "/api/media/serve/";
  const MEDIA_HOST = "media.verifymzansi.com";

  beforeEach(() => {
    vi.resetModules();
  });

  async function importLoader(cfEnabled: boolean) {
    vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", cfEnabled ? "true" : "false");
    const mod = await import("@/lib/image-loader");
    return mod.default;
  }

  it("returns proxy path unchanged when CF resizing is disabled", async () => {
    const loader = await importLoader(false);
    const result = loader({
      src: `${PROXY}media/listing/abc.jpg`,
      width: 800,
      quality: 75,
    });
    expect(result).toBe(`${PROXY}media/listing/abc.jpg?w=800&q=75`);
  });

  it("passes proxy path through unchanged even when CF resizing is enabled", async () => {
    const loader = await importLoader(true);
    const result = loader({
      src: `${PROXY}media/listing/abc.jpg`,
      width: 800,
      quality: 75,
    });
    expect(result).toBe(
      "/cdn-cgi/image/width=800,quality=75,format=auto/api/media/serve/media/listing/abc.jpg"
    );
  });

  it("continues to convert CDN domain URLs when CF resizing is enabled", async () => {
    const loader = await importLoader(true);
    const result = loader({
      src: `https://${MEDIA_HOST}/media/listing/abc.jpg`,
      width: 600,
    });
    expect(result).toMatch(/^\/cdn-cgi\/image\//);
    expect(result).toContain("width=600");
    expect(result).toContain("/media/listing/abc.jpg");
  });

  it("returns width-aware src for relative non-proxy paths", async () => {
    const loader = await importLoader(true);
    const result = loader({
      src: "/images/logo.png",
      width: 200,
    });
    expect(result).toBe("/cdn-cgi/image/width=200,quality=75,format=auto/images/logo.png");
  });
});
