import { describe, it, expect } from "vitest";
import {
  isTrustedPlatformMediaUrl,
  extractMediaStorageKey,
  normalizeMediaUrl,
  normalizeVideoUrl,
} from "./media-url";

describe("isTrustedPlatformMediaUrl", () => {
  it("trusts media.verifymzansi.com", () => {
    expect(isTrustedPlatformMediaUrl("https://media.verifymzansi.com/photos/abc.jpg")).toBe(true);
  });

  it("trusts r2.cloudflarestorage.com", () => {
    expect(isTrustedPlatformMediaUrl("https://xyz.r2.cloudflarestorage.com/img.png")).toBe(true);
  });

  it("trusts supabase.co", () => {
    expect(isTrustedPlatformMediaUrl("https://abc.supabase.co/storage/v1/img.jpg")).toBe(true);
  });

  it("rejects unknown hosts", () => {
    expect(isTrustedPlatformMediaUrl("https://evil.example.com/img.jpg")).toBe(false);
  });

  it("rejects invalid URLs", () => {
    expect(isTrustedPlatformMediaUrl("not-a-url")).toBe(false);
  });
});

describe("extractMediaStorageKey", () => {
  it("extracts key from raw storage key", () => {
    expect(extractMediaStorageKey("media/listing/abc.jpg")).toBe("media/listing/abc.jpg");
  });

  it("extracts key from proxy prefix", () => {
    expect(extractMediaStorageKey("/api/media/serve/photos/abc.jpg")).toBe("photos/abc.jpg");
  });

  it("extracts key from absolute app proxy URL", () => {
    expect(
      extractMediaStorageKey("https://verifymzansi.com/api/media/serve/media/listing/abc.jpg")
    ).toBe("media/listing/abc.jpg");
  });

  it("extracts key from media base URL", () => {
    expect(extractMediaStorageKey("https://media.verifymzansi.com/photos/abc.jpg")).toBe(
      "photos/abc.jpg"
    );
  });

  it("extracts key from staging media base URL", () => {
    expect(extractMediaStorageKey("https://media-staging.verifymzansi.com/photos/abc.jpg")).toBe(
      "photos/abc.jpg"
    );
  });

  it("extracts key from R2 URL", () => {
    expect(extractMediaStorageKey("https://xyz.r2.cloudflarestorage.com/photos/abc.jpg")).toBe(
      "photos/abc.jpg"
    );
  });

  it("returns null for unrecognized URL", () => {
    expect(extractMediaStorageKey("https://other.example.com/img.jpg")).toBeNull();
  });
});

describe("normalizeMediaUrl", () => {
  it("returns empty string for null/undefined", () => {
    expect(normalizeMediaUrl(null)).toBe("");
    expect(normalizeMediaUrl(undefined)).toBe("");
  });

  it("returns proxy route for image URLs", () => {
    const result = normalizeMediaUrl("https://media.verifymzansi.com/photos/abc.jpg");
    expect(result).toBe("/api/media/serve/photos/abc.jpg");
  });

  it("routes video URLs through proxy", () => {
    const result = normalizeMediaUrl("https://media.verifymzansi.com/videos/clip.mp4");
    expect(result).toBe("/api/media/serve/videos/clip.mp4");
  });

  it("returns original string for unrecognized URL", () => {
    expect(normalizeMediaUrl("https://other.example.com/img.jpg")).toBe(
      "https://other.example.com/img.jpg"
    );
  });

  it("routes webm videos through proxy", () => {
    const result = normalizeMediaUrl("https://media.verifymzansi.com/videos/clip.webm");
    expect(result).toBe("/api/media/serve/videos/clip.webm");
  });

  it("routes .mov videos through proxy for correct MIME mapping", () => {
    const result = normalizeMediaUrl("https://media.verifymzansi.com/videos/legacy.mov");
    expect(result).toBe("/api/media/serve/videos/legacy.mov");
  });
});

describe("normalizeVideoUrl", () => {
  it("returns empty string for null/undefined", () => {
    expect(normalizeVideoUrl(null)).toBe("");
    expect(normalizeVideoUrl(undefined)).toBe("");
  });

  it("routes mp4 videos through proxy", () => {
    const result = normalizeVideoUrl("https://media.verifymzansi.com/videos/clip.mp4");
    expect(result).toBe("/api/media/serve/videos/clip.mp4");
  });

  it("routes webm videos through proxy", () => {
    const result = normalizeVideoUrl("https://media.verifymzansi.com/videos/clip.webm");
    expect(result).toBe("/api/media/serve/videos/clip.webm");
  });

  it("routes .mov videos through proxy", () => {
    const result = normalizeVideoUrl("https://media.verifymzansi.com/videos/legacy.mov");
    expect(result).toBe("/api/media/serve/videos/legacy.mov");
  });

  it("returns original string for unrecognized URL", () => {
    expect(normalizeVideoUrl("https://other.example.com/vid.mp4")).toBe(
      "https://other.example.com/vid.mp4"
    );
  });
});
