import { describe, it, expect, vi, beforeEach } from "vitest";

describe("cloudflareImageLoader", () => {
  const PROXY = "/api/media/serve/";
  const MEDIA_HOST = "media.verifymzansi.com";
  const STAGING_MEDIA_HOST = "media-staging.verifymzansi.com";

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
    expect(result).toBe(`${PROXY}media/listing/abc.jpg`);
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

  it("continues to convert the staging CDN domain when CF resizing is enabled", async () => {
    const loader = await importLoader(true);
    const result = loader({
      src: `https://${STAGING_MEDIA_HOST}/media/listing/def.jpg`,
      width: 420,
    });
    expect(result).toBe("/cdn-cgi/image/width=420,quality=75,format=auto/media/listing/def.jpg");
  });

  it("returns width-aware src for relative non-proxy paths under CF resizing", async () => {
    const loader = await importLoader(true);
    const result = loader({
      src: "/images/logo.png",
      width: 200,
    });
    expect(result).toBe("/images/logo.png?w=200&q=75");
  });

  it("preserves existing query params and hash fragments when width and quality are appended", async () => {
    const loader = await importLoader(true);
    const result = loader({
      src: "/images/logo.png?fit=cover#hero",
      width: 320,
      quality: 80,
    });
    expect(result).toBe("/images/logo.png?fit=cover&w=320&q=80#hero");
  });

  it("returns width-aware URLs for remote absolute sources instead of routing them through Cloudflare", async () => {
    const loader = await importLoader(true);
    const result = loader({
      src: "https://images.unsplash.com/photo-123?auto=format#preview",
      width: 640,
    });
    expect(result).toBe("https://images.unsplash.com/photo-123?auto=format&w=640&q=75#preview");
  });
});
