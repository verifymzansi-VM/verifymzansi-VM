import { describe, it, expect } from "vitest";
import { normalizeMediaUrl, extractMediaStorageKey, getMediaCdnUrl } from "@/lib/utils/media-url";

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

  // Backward-compatible URL routing (Step 24)
  describe("backward compatibility", () => {
    it("normalizeMediaUrl routes raw media keys and leaves other paths unchanged", () => {
      expect(normalizeMediaUrl("media/old-photo.jpg")).toBe("/api/media/serve/media/old-photo.jpg");
      expect(normalizeMediaUrl("listings/old-photo.jpg")).toBe("listings/old-photo.jpg");
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
