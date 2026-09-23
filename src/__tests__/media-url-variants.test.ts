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

    it("returns an R2 WebP proxy URL for the thumb variant", () => {
      const url = getVariantUrl("/api/media/serve/media/listing/abc.jpg", "thumb");
      expect(url).toBe("/api/media/serve/media/listing/abc.w400.webp");
    });

    it("returns an R2 WebP proxy URL for the card variant", () => {
      const url = getVariantUrl("media/listing/abc.jpg", "card");
      expect(url).toBe("/api/media/serve/media/listing/abc.w800.webp");
    });

    it("returns an R2 WebP proxy URL for the full variant", () => {
      const url = getVariantUrl("media/listing/abc.jpg", "full");
      expect(url).toBe("/api/media/serve/media/listing/abc.w1600.webp");
    });

    it("returns the direct CDN URL for video files regardless of variant", () => {
      const url = getVariantUrl("/api/media/serve/media/listing/clip.mp4", "thumb");
      expect(url).toBe("https://media.verifymzansi.com/media/listing/clip.mp4");
    });

    it("falls back to original URL for unrecognised input", () => {
      const url = getVariantUrl("https://example.com/foo.jpg", "card");
      expect(url).toBe("https://example.com/foo.jpg");
    });

    it("does not double-rewrite an existing variant", () => {
      expect(getVariantUrl("media/listing/abc.w400.webp", "card")).toBe(
        "/api/media/serve/media/listing/abc.w400.webp"
      );
    });
  });

  describe("getResponsiveImageUrls", () => {
    it("returns all four variant URLs", () => {
      const urls = getResponsiveImageUrls("/api/media/serve/media/listing/abc.jpg");
      expect(urls.thumb).toBe("/api/media/serve/media/listing/abc.w400.webp");
      expect(urls.card).toBe("/api/media/serve/media/listing/abc.w800.webp");
      expect(urls.full).toBe("/api/media/serve/media/listing/abc.w1600.webp");
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
