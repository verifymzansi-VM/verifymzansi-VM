import { describe, expect, it } from "vitest";

import {
  ALL_UPLOAD_MIME_TYPES,
  IMAGE_UPLOAD_MIME_TYPES,
  MIME_EXTENSION_MAP,
  VIDEO_UPLOAD_MIME_TYPES,
  getExtensionForMimeType,
  normalizeSelectedFile,
  normalizeUploadFilename,
} from "./media-upload";

describe("media-upload utils", () => {
  it("exports supported image and video mime types", () => {
    expect(IMAGE_UPLOAD_MIME_TYPES).toContain("image/jpeg");
    expect(VIDEO_UPLOAD_MIME_TYPES).toContain("video/mp4");
    expect(ALL_UPLOAD_MIME_TYPES).toEqual([...IMAGE_UPLOAD_MIME_TYPES, ...VIDEO_UPLOAD_MIME_TYPES]);
  });

  it("maps known mime types to extensions", () => {
    expect(MIME_EXTENSION_MAP["image/webp"]).toBe("webp");
    expect(getExtensionForMimeType("video/webm")).toBe("webm");
  });

  it("returns null for unknown mime type extension lookup", () => {
    expect(getExtensionForMimeType("application/octet-stream")).toBeNull();
  });

  it("normalizes filename using mime extension", () => {
    expect(normalizeUploadFilename("my photo.PNG", "image/jpeg")).toBe("my-photo.jpg");
  });

  it("sanitizes unsafe filename characters and collapses separators", () => {
    expect(normalizeUploadFilename("  my***cool///file!!.name  ", "image/png")).toBe(
      "my-cool-file.png"
    );
  });

  it("falls back to upload stem when filename sanitizes to empty", () => {
    expect(normalizeUploadFilename("...", "image/png")).toBe("upload.png");
  });

  it("returns sanitized stem without extension when mime type is unknown", () => {
    expect(normalizeUploadFilename("bad file name.txt", "application/x-custom")).toBe(
      "bad-file-name"
    );
  });

  it("normalizeSelectedFile returns same file when no rename is needed", () => {
    const original = new File(["abc"], "photo.jpg", {
      type: "image/jpeg",
      lastModified: 123,
    });

    expect(normalizeSelectedFile(original)).toBe(original);
  });

  it("normalizeSelectedFile returns a new File with normalized name when needed", async () => {
    const original = new File(["abc"], "messy name.png", {
      type: "image/jpeg",
      lastModified: 456,
    });

    const normalized = normalizeSelectedFile(original);

    expect(normalized).not.toBe(original);
    expect(normalized.name).toBe("messy-name.jpg");
    expect(normalized.type).toBe("image/jpeg");
    expect(normalized.lastModified).toBe(456);
    await expect(normalized.text()).resolves.toBe("abc");
  });
});
