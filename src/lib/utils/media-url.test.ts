import { describe, it, expect } from "vitest";
import { isTrustedPlatformMediaUrl, extractMediaStorageKey, normalizeMediaUrl } from "./media-url";

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
  it("extracts key from proxy prefix", () => {
    expect(extractMediaStorageKey("/api/media/serve/photos/abc.jpg")).toBe("photos/abc.jpg");
  });

  it("extracts key from media base URL", () => {
    expect(extractMediaStorageKey("https://media.verifymzansi.com/photos/abc.jpg")).toBe(
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

  it("returns CDN URL for video URLs", () => {
    const result = normalizeMediaUrl("https://media.verifymzansi.com/videos/clip.mp4");
    expect(result).toBe("https://media.verifymzansi.com/videos/clip.mp4");
  });

  it("returns original string for unrecognized URL", () => {
    expect(normalizeMediaUrl("https://other.example.com/img.jpg")).toBe(
      "https://other.example.com/img.jpg"
    );
  });

  it("handles webm video extension", () => {
    const result = normalizeMediaUrl("https://media.verifymzansi.com/videos/clip.webm");
    expect(result).toBe("https://media.verifymzansi.com/videos/clip.webm");
  });
});
