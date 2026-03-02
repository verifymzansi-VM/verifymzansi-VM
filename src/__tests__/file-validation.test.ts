import { describe, it, expect } from "vitest";
import {
  detectMimeFromMagicBytes,
  validateBufferIntegrity,
  isAllowedImageType,
  isAllowedDocType,
} from "@/lib/utils/file-validation";

describe("File Validation", () => {
  // All test buffers must be >= 12 bytes (the minimum required by detectMimeFromMagicBytes)
  function padded(bytes: number[]): Uint8Array {
    const buf = new Uint8Array(12);
    bytes.forEach((b, i) => {
      buf[i] = b;
    });
    return buf;
  }

  describe("detectMimeFromMagicBytes", () => {
    it("detects JPEG", () => {
      const buf = padded([0xff, 0xd8, 0xff, 0xe0]);
      expect(detectMimeFromMagicBytes(buf)).toBe("image/jpeg");
    });

    it("detects PNG", () => {
      const buf = padded([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(detectMimeFromMagicBytes(buf)).toBe("image/png");
    });

    it("detects WebP", () => {
      // RIFF....WEBP
      const buf = new Uint8Array([
        0x52,
        0x49,
        0x46,
        0x46, // RIFF
        0x00,
        0x00,
        0x00,
        0x00, // size
        0x57,
        0x45,
        0x42,
        0x50, // WEBP
      ]);
      expect(detectMimeFromMagicBytes(buf)).toBe("image/webp");
    });

    it("detects PDF", () => {
      const buf = padded([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
      expect(detectMimeFromMagicBytes(buf)).toBe("application/pdf");
    });

    it("returns null for unknown bytes", () => {
      const buf = padded([0x00, 0x00, 0x00, 0x00]);
      expect(detectMimeFromMagicBytes(buf)).toBeNull();
    });

    it("detects AVIF", () => {
      // ISO BMFF: 4 byte size + "ftypavif"
      const buf = new Uint8Array([
        0x00,
        0x00,
        0x00,
        0x1c, // box size
        0x66,
        0x74,
        0x79,
        0x70, // ftyp
        0x61,
        0x76,
        0x69,
        0x66, // avif
      ]);
      expect(detectMimeFromMagicBytes(buf)).toBe("image/avif");
    });

    it("returns null for empty buffer", () => {
      expect(detectMimeFromMagicBytes(new Uint8Array(0))).toBeNull();
    });

    it("returns null for buffer smaller than 12 bytes", () => {
      const buf = new Uint8Array([0xff, 0xd8, 0xff]);
      expect(detectMimeFromMagicBytes(buf)).toBeNull();
    });
  });

  describe("validateBufferIntegrity", () => {
    it("accepts matching JPEG bytes and declared type", () => {
      const buf = padded([0xff, 0xd8, 0xff, 0xe0]);
      const result = validateBufferIntegrity(buf, "image/jpeg");
      expect(result.valid).toBe(true);
    });

    it("rejects mismatched magic bytes vs declared type", () => {
      const jpegBytes = padded([0xff, 0xd8, 0xff, 0xe0]);
      const result = validateBufferIntegrity(jpegBytes, "image/png");
      expect(result.valid).toBe(false);
      expect(result.mismatch).toBe(true);
    });

    it("rejects unknown magic bytes", () => {
      const buf = padded([0x00, 0x01, 0x02, 0x03]);
      const result = validateBufferIntegrity(buf, "image/jpeg");
      expect(result.valid).toBe(false);
    });
  });

  describe("isAllowedImageType", () => {
    it("allows JPEG", () => {
      expect(isAllowedImageType("image/jpeg")).toBe(true);
    });

    it("allows PNG", () => {
      expect(isAllowedImageType("image/png")).toBe(true);
    });

    it("allows WebP", () => {
      expect(isAllowedImageType("image/webp")).toBe(true);
    });

    it("allows GIF", () => {
      expect(isAllowedImageType("image/gif")).toBe(true);
    });

    it("allows AVIF", () => {
      expect(isAllowedImageType("image/avif")).toBe(true);
    });

    it("rejects PDF", () => {
      expect(isAllowedImageType("application/pdf")).toBe(false);
    });
  });

  describe("isAllowedDocType", () => {
    it("allows all image types", () => {
      expect(isAllowedDocType("image/jpeg")).toBe(true);
      expect(isAllowedDocType("image/png")).toBe(true);
    });

    it("allows PDF", () => {
      expect(isAllowedDocType("application/pdf")).toBe(true);
    });

    it("rejects arbitrary types", () => {
      expect(isAllowedDocType("application/zip")).toBe(false);
    });
  });
});
