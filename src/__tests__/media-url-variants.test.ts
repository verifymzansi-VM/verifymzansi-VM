import { describe, it, expect } from "vitest";
import {
  normalizeMediaUrl,
  extractMediaStorageKey,
  getMediaCdnUrl,
  getVariantUrl,
  getResponsiveImageUrls,
} from "@/lib/utils/media-url";

describe("media-url variant helpers", () => {
  describe("getMediaCdnUrl", () => {
    it("resolves a proxy path to a CDN URL", () => {
      const url = getMediaCdnUrl("/api/media/serve/media/listing/abc.jpg");
      expect(url).toBe("https://media.verifymzansi.com/media/listing/abc.jpg");
    });

    it("resolves a raw storage key to a CDN URL", () => {
      const url = getMediaCdnUrl("media/listing/abc.jpg");
      expect(url).toBe("https://media.verifymzansi.com/media/listing/abc.jpg");
    });

    it("returns the original URL when key cannot be extracted", () => {
      const url = getMediaCdnUrl("https://example.com/unrelated.jpg");
      expect(url).toBe("https://example.com/unrelated.jpg");
    });
  });

  describe("getVariantUrl", () => {
    it("returns proxy path for original variant", () => {
      const url = getVariantUrl("/api/media/serve/media/listing/abc.jpg", "original");
      expect(url).toBe("/api/media/serve/media/listing/abc.jpg");
    });

    it("returns CDN-cgi URL for thumb variant", () => {
      const url = getVariantUrl("/api/media/serve/media/listing/abc.jpg", "thumb");
      expect(url).toContain("/cdn-cgi/image/");
      expect(url).toContain("width=400");
      expect(url).toContain("quality=80");
      expect(url).toContain("format=auto");
      expect(url).toContain("media.verifymzansi.com/media/listing/abc.jpg");
    });

    it("returns CDN-cgi URL for card variant", () => {
      const url = getVariantUrl("media/listing/abc.jpg", "card");
      expect(url).toContain("width=800");
      expect(url).toContain("quality=85");
    });

    it("returns CDN-cgi URL for full variant", () => {
      const url = getVariantUrl("media/listing/abc.jpg", "full");
      expect(url).toContain("width=1600");
      expect(url).toContain("quality=90");
    });

    it("returns proxy path for video files regardless of variant", () => {
      const url = getVariantUrl("/api/media/serve/media/listing/clip.mp4", "thumb");
      expect(url).toBe("/api/media/serve/media/listing/clip.mp4");
    });

    it("falls back to original URL for unrecognised input", () => {
      const url = getVariantUrl("https://example.com/foo.jpg", "card");
      expect(url).toBe("https://example.com/foo.jpg");
    });
  });

  describe("getResponsiveImageUrls", () => {
    it("returns all four variant URLs", () => {
      const urls = getResponsiveImageUrls("/api/media/serve/media/listing/abc.jpg");
      expect(urls.thumb).toContain("width=400");
      expect(urls.card).toContain("width=800");
      expect(urls.full).toContain("width=1600");
      expect(urls.original).toBe("/api/media/serve/media/listing/abc.jpg");
    });
  });

  // Backward-compatible URL routing (Step 24)
  describe("backward compatibility", () => {
    it("normalizeMediaUrl still works for legacy keys", () => {
      const url = normalizeMediaUrl("listings/old-photo.jpg");
      expect(url).toBe("/api/media/serve/listings/old-photo.jpg");
    });

    it("normalizeMediaUrl still works for CDN URLs", () => {
      const url = normalizeMediaUrl("https://media.verifymzansi.com/media/listing/abc.jpg");
      expect(url).toBe("/api/media/serve/media/listing/abc.jpg");
    });

    it("extractMediaStorageKey still extracts correctly", () => {
      const key = extractMediaStorageKey("https://media.verifymzansi.com/media/listing/abc.jpg");
      expect(key).toBe("media/listing/abc.jpg");
    });
  });
});
