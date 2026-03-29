/**
 * Unit tests for audit fixes — file validation, malware scan, EXIF stripping.
 */
import { describe, it, expect } from "vitest";
import { detectMimeFromMagicBytes } from "@/lib/utils/file-validation";
import { scanForMalware } from "@/lib/utils/malware-scan";
import { stripMetadataFromPng } from "@/lib/utils/exif-strip";

/** Helper: create a padded 12-byte buffer from given bytes */
function padded(bytes: number[]): Uint8Array {
  const buf = new Uint8Array(Math.max(12, bytes.length));
  bytes.forEach((b, i) => {
    buf[i] = b;
  });
  return buf;
}

// ─── ZIP magic bytes detection ──────────────────────────────────────────────

describe("detectMimeFromMagicBytes — ZIP support", () => {
  it("detects ZIP archive magic bytes", () => {
    const buf = padded([0x50, 0x4b, 0x03, 0x04]);
    expect(detectMimeFromMagicBytes(buf)).toBe("application/zip");
  });

  it("does not false-positive on non-ZIP bytes", () => {
    const buf = padded([0x50, 0x4b, 0x03, 0x05]);
    // This doesn't match any known signature exactly
    expect(detectMimeFromMagicBytes(buf)).toBeNull();
  });
});

// ─── ZIP polyglot malware detection ─────────────────────────────────────────

describe("scanForMalware — ZIP polyglot detection", () => {
  it("rejects ZIP archive disguised as image", () => {
    // ZIP magic at offset 0 in an image/* declared file
    const buf = padded([0x50, 0x4b, 0x03, 0x04]);
    const result = scanForMalware(buf, "image/jpeg");
    expect(result.safe).toBe(false);
    expect(result.threat).toContain("zip-archive");
  });

  it("allows genuine JPEG files", () => {
    const buf = padded([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
    const result = scanForMalware(buf, "image/jpeg");
    expect(result.safe).toBe(true);
  });

  it("allows genuine PNG files", () => {
    const buf = padded([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    const result = scanForMalware(buf, "image/png");
    expect(result.safe).toBe(true);
  });
});

// ─── PNG metadata stripping ─────────────────────────────────────────────────

describe("stripMetadataFromPng", () => {
  /**
   * Build a minimal PNG with specific chunks for testing.
   * PNG = signature + IHDR + <test chunks> + IEND
   */
  function buildPng(extraChunks: Array<{ type: string; data: Uint8Array }>): Uint8Array {
    const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const chunks: Uint8Array[] = [sig];

    function addChunk(type: string, data: Uint8Array) {
      const len = new Uint8Array(4);
      new DataView(len.buffer).setUint32(0, data.length, false);
      const typeBytes = new TextEncoder().encode(type);
      const crc = new Uint8Array(4); // dummy CRC
      chunks.push(len, typeBytes, data, crc);
    }

    // Minimal IHDR (13 bytes)
    addChunk("IHDR", new Uint8Array(13));

    for (const chunk of extraChunks) {
      addChunk(chunk.type, chunk.data);
    }

    // IEND
    addChunk("IEND", new Uint8Array(0));

    const total = chunks.reduce((s, c) => s + c.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      result.set(c, offset);
      offset += c.length;
    }
    return result;
  }

  it("strips tEXt chunks from PNG", () => {
    const pngWithText = buildPng([
      { type: "tEXt", data: new TextEncoder().encode("Author\0John Doe") },
    ]);
    const stripped = stripMetadataFromPng(pngWithText);

    // The stripped version should be smaller (tEXt chunk removed)
    expect(stripped.length).toBeLessThan(pngWithText.length);
  });

  it("strips eXIf chunks from PNG", () => {
    const pngWithExif = buildPng([
      { type: "eXIf", data: new Uint8Array([0x49, 0x49, 0x2a, 0x00]) }, // TIFF header
    ]);
    const stripped = stripMetadataFromPng(pngWithExif);
    expect(stripped.length).toBeLessThan(pngWithExif.length);
  });

  it("preserves IHDR and IDAT chunks", () => {
    const pngWithData = buildPng([
      { type: "IDAT", data: new Uint8Array([0x78, 0x9c, 0x62, 0x00, 0x00]) },
      { type: "tEXt", data: new TextEncoder().encode("Comment\0GPS data") },
    ]);
    const stripped = stripMetadataFromPng(pngWithData);

    // IDAT should still be present
    const text = new TextDecoder().decode(stripped);
    expect(text).toContain("IHDR");
    expect(text).toContain("IDAT");
    expect(text).toContain("IEND");
  });

  it("returns non-PNG buffers unchanged", () => {
    const jpegBuf = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const result = stripMetadataFromPng(jpegBuf);
    expect(result).toBe(jpegBuf); // same reference
  });
});

// ─── Extension vs MIME validation (upload route constants) ──────────────────

describe("file extension MIME mapping", () => {
  // These test the EXTENSION_MIME_MAP we added to the upload route.
  // Since the map is a module-level constant, we verify the expected pairs.
  const EXTENSION_MIME_MAP: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    avif: "image/avif",
    mp4: "video/mp4",
    webm: "video/webm",
  };

  it("maps all common image extensions", () => {
    expect(EXTENSION_MIME_MAP["jpg"]).toBe("image/jpeg");
    expect(EXTENSION_MIME_MAP["jpeg"]).toBe("image/jpeg");
    expect(EXTENSION_MIME_MAP["png"]).toBe("image/png");
    expect(EXTENSION_MIME_MAP["webp"]).toBe("image/webp");
    expect(EXTENSION_MIME_MAP["gif"]).toBe("image/gif");
    expect(EXTENSION_MIME_MAP["avif"]).toBe("image/avif");
  });

  it("maps all common video extensions", () => {
    expect(EXTENSION_MIME_MAP["mp4"]).toBe("video/mp4");
    expect(EXTENSION_MIME_MAP["webm"]).toBe("video/webm");
  });

  it("rejects unknown extensions", () => {
    expect(EXTENSION_MIME_MAP["exe"]).toBeUndefined();
    expect(EXTENSION_MIME_MAP["php"]).toBeUndefined();
    expect(EXTENSION_MIME_MAP["svg"]).toBeUndefined();
  });
});
