import { describe, it, expect } from "vitest";
import { stripExifFromJpeg, isJpegWithExif } from "./exif-strip";

describe("exif-strip", () => {
  /** Build a minimal valid JPEG with an APP1 (EXIF) segment. */
  function buildJpegWithExif(): Uint8Array {
    // SOI + APP1 (EXIF with dummy data) + SOS + image data + EOI
    const soi = [0xff, 0xd8]; // Start of Image
    // APP1 marker + length (2 bytes: 0x00 0x08 = 8 bytes including length) + "Exif\0\0"
    const app1 = [0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
    // APP0 (JFIF — should be preserved)
    const app0 = [0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46];
    // SOS (Start of Scan) + dummy compressed data + EOI
    const sos = [0xff, 0xda, 0x00, 0x02]; // minimal SOS
    const imageData = [0x01, 0x02, 0x03]; // dummy data
    const eoi = [0xff, 0xd9]; // End of Image

    return new Uint8Array([...soi, ...app0, ...app1, ...sos, ...imageData, ...eoi]);
  }

  /** Build a JPEG without EXIF. */
  function buildJpegWithoutExif(): Uint8Array {
    const soi = [0xff, 0xd8];
    const app0 = [0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46];
    const sos = [0xff, 0xda, 0x00, 0x02];
    const imageData = [0x01, 0x02, 0x03];
    const eoi = [0xff, 0xd9];
    return new Uint8Array([...soi, ...app0, ...sos, ...imageData, ...eoi]);
  }

  describe("stripExifFromJpeg", () => {
    it("removes APP1 (EXIF) segments from JPEG", () => {
      const input = buildJpegWithExif();
      const output = stripExifFromJpeg(input);

      // Output should be smaller (APP1 removed)
      expect(output.length).toBeLessThan(input.length);

      // Output should still start with SOI
      expect(output[0]).toBe(0xff);
      expect(output[1]).toBe(0xd8);

      // Output should NOT contain APP1 marker
      let hasApp1 = false;
      for (let i = 0; i < output.length - 1; i++) {
        if (output[i] === 0xff && output[i + 1] === 0xe1) {
          hasApp1 = true;
          break;
        }
      }
      expect(hasApp1).toBe(false);
    });

    it("preserves non-EXIF segments like APP0 (JFIF)", () => {
      const input = buildJpegWithExif();
      const output = stripExifFromJpeg(input);

      // APP0 should still be present
      let hasApp0 = false;
      for (let i = 0; i < output.length - 1; i++) {
        if (output[i] === 0xff && output[i + 1] === 0xe0) {
          hasApp0 = true;
          break;
        }
      }
      expect(hasApp0).toBe(true);
    });

    it("returns non-JPEG files unchanged", () => {
      const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const output = stripExifFromJpeg(pngHeader);
      expect(output).toEqual(pngHeader);
    });

    it("handles JPEG without EXIF gracefully", () => {
      const input = buildJpegWithoutExif();
      const output = stripExifFromJpeg(input);

      // Should still be valid (starts with SOI)
      expect(output[0]).toBe(0xff);
      expect(output[1]).toBe(0xd8);
    });
  });

  describe("isJpegWithExif", () => {
    it("detects JPEG with EXIF", () => {
      expect(isJpegWithExif(buildJpegWithExif())).toBe(true);
    });

    it("returns false for JPEG without EXIF", () => {
      expect(isJpegWithExif(buildJpegWithoutExif())).toBe(false);
    });

    it("returns false for non-JPEG", () => {
      expect(isJpegWithExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    });
  });
});
