import { describe, it, expect } from "vitest";
import {
  stripExifFromJpeg,
  stripMetadataFromPng,
  stripMetadataFromWebp,
  isJpegWithExif,
} from "./exif-strip";

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

  describe("stripMetadataFromPng", () => {
    /** Build a minimal PNG with an eXIf chunk between IHDR and IEND. */
    function buildPngWithExif(): Uint8Array {
      const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
      const chunk = (type: string, data: number[]) => [
        (data.length >>> 24) & 0xff,
        (data.length >> 16) & 0xff,
        (data.length >> 8) & 0xff,
        data.length & 0xff,
        ...ascii(type),
        ...data,
        0x00,
        0x00,
        0x00,
        0x00, // fake CRC — the stripper does not validate it
      ];
      return new Uint8Array([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a,
        ...chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
        ...chunk("eXIf", [0x45, 0x78, 0x69, 0x66]),
        ...chunk("IEND", []),
      ]);
    }

    it("removes eXIf chunks from PNG", () => {
      const input = buildPngWithExif();
      const output = stripMetadataFromPng(input);

      expect(output.length).toBeLessThan(input.length);
      // Signature and critical chunks preserved
      expect([...output.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const asAscii = [...output].map((b) => String.fromCharCode(b)).join("");
      expect(asAscii).toContain("IHDR");
      expect(asAscii).toContain("IEND");
      expect(asAscii).not.toContain("eXIf");
    });

    it("returns safely when a PNG declares an impossible chunk length", () => {
      const malformed = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        // length = 0x80000000. This used to become a negative signed int and
        // move the parser offset backwards, spinning until the Worker timed out.
        0x80, 0x00, 0x00, 0x00, 0x74, 0x45, 0x58, 0x74,
      ]);

      expect(stripMetadataFromPng(malformed)).toEqual(malformed.slice(0, 8));
    });
  });

  describe("stripMetadataFromWebp", () => {
    /** Build a WebP (RIFF) buffer from a list of [type, data] chunks. */
    function buildWebp(chunks: Array<[string, number[]]>): Uint8Array {
      const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
      const body: number[] = [0x57, 0x45, 0x42, 0x50]; // "WEBP"
      for (const [type, data] of chunks) {
        body.push(...ascii(type));
        body.push(
          data.length & 0xff,
          (data.length >> 8) & 0xff,
          (data.length >> 16) & 0xff,
          (data.length >>> 24) & 0xff
        );
        body.push(...data);
        if (data.length % 2 === 1) body.push(0); // chunks are padded to even sizes
      }
      return new Uint8Array([
        0x52,
        0x49,
        0x46,
        0x46, // "RIFF"
        body.length & 0xff,
        (body.length >> 8) & 0xff,
        (body.length >> 16) & 0xff,
        (body.length >>> 24) & 0xff,
        ...body,
      ]);
    }

    const asciiOf = (buf: Uint8Array) => [...buf].map((b) => String.fromCharCode(b)).join("");

    it("removes EXIF chunks and clears the VP8X EXIF flag", () => {
      const input = buildWebp([
        ["VP8X", [0x08, 0, 0, 0, 0, 0, 0, 0, 0, 0]], // flags: EXIF present
        ["EXIF", [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]], // "Exif\0\0"
        ["VP8 ", [0x01, 0x02, 0x03, 0x04]],
      ]);

      const output = stripMetadataFromWebp(input);

      expect(output.length).toBeLessThan(input.length);
      expect(asciiOf(output)).not.toContain("EXIF");
      expect(asciiOf(output)).toContain("VP8 ");
      // VP8X flags byte (offset 12 header + 8 chunk header) must be cleared
      expect(output[20] & 0x08).toBe(0);
      // RIFF size field matches the new total length
      const riffSize = output[4] | (output[5] << 8) | (output[6] << 16) | (output[7] << 24);
      expect(riffSize).toBe(output.length - 8);
    });

    it("removes XMP chunks and clears the VP8X XMP flag", () => {
      const input = buildWebp([
        ["VP8X", [0x04, 0, 0, 0, 0, 0, 0, 0, 0, 0]], // flags: XMP present
        ["XMP ", [0x3c, 0x78, 0x6d, 0x6c, 0x3e]], // "<xml>"
        ["VP8 ", [0x01, 0x02, 0x03, 0x04]],
      ]);

      const output = stripMetadataFromWebp(input);

      expect(asciiOf(output)).not.toContain("XMP ");
      expect(output[20] & 0x04).toBe(0);
    });

    it("handles odd-sized metadata chunks (padding byte)", () => {
      const input = buildWebp([
        ["VP8X", [0x08, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
        ["EXIF", [0x01, 0x02, 0x03]], // odd length → 1 pad byte
        ["VP8 ", [0x0a, 0x0b, 0x0c]], // odd length → kept with its pad byte
      ]);

      const output = stripMetadataFromWebp(input);

      expect(asciiOf(output)).not.toContain("EXIF");
      expect(asciiOf(output)).toContain("VP8 ");
      // Odd-sized kept chunk survives with its payload and even-size pad byte
      expect([...output.slice(-4)]).toEqual([0x0a, 0x0b, 0x0c, 0x00]);
      const riffSize = output[4] | (output[5] << 8) | (output[6] << 16) | (output[7] << 24);
      expect(riffSize).toBe(output.length - 8);
    });

    it("returns a WebP without metadata byte-identical", () => {
      const input = buildWebp([
        ["VP8X", [0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
        ["VP8 ", [0x01, 0x02, 0x03, 0x04]],
      ]);

      expect(stripMetadataFromWebp(input)).toEqual(input);
    });

    it("returns non-WebP buffers unchanged", () => {
      const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      expect(stripMetadataFromWebp(jpeg)).toEqual(jpeg);
    });

    it("returns safely when a chunk declares an impossible length", () => {
      const truncated = buildWebp([["VP8 ", [0x01, 0x02]]]);
      // Corrupt the VP8 chunk size to claim more data than the buffer holds
      truncated[16] = 0xff;
      truncated[17] = 0xff;
      truncated[18] = 0xff;
      truncated[19] = 0x7f;

      const output = stripMetadataFromWebp(truncated);
      // Corrupt tail is dropped, RIFF/WEBP header is preserved
      expect([...output.slice(0, 4)]).toEqual([0x52, 0x49, 0x46, 0x46]);
      expect([...output.slice(8, 12)]).toEqual([0x57, 0x45, 0x42, 0x50]);
      expect(output.length).toBe(12);
    });
  });
});
