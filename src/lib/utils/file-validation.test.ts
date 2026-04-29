import { describe, it, expect } from "vitest";
import {
  detectMimeFromMagicBytes,
  validateBufferIntegrity,
  isAllowedImageType,
  isAllowedDocType,
} from "./file-validation";

/** Helper: build a buffer from byte arrays with padding */
function makeBuffer(bytes: number[], totalLength = 24): Uint8Array {
  const buf = new Uint8Array(totalLength);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes[i];
  return buf;
}

/** Build buffer with bytes at an offset */
function makeBufferAt(offset: number, bytes: number[], totalLength = 24): Uint8Array {
  const buf = new Uint8Array(totalLength);
  for (let i = 0; i < bytes.length; i++) buf[offset + i] = bytes[i];
  return buf;
}

describe("detectMimeFromMagicBytes", () => {
  it("detects JPEG", () => {
    const buf = makeBuffer([0xff, 0xd8, 0xff, 0xe0]);
    expect(detectMimeFromMagicBytes(buf)).toBe("image/jpeg");
  });

  it("detects PNG", () => {
    const buf = makeBuffer([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectMimeFromMagicBytes(buf)).toBe("image/png");
  });

  it("detects WebP (RIFF + WEBP at offset 8)", () => {
    // RIFF at 0, WEBP at 8
    const buf = new Uint8Array(24);
    [0x52, 0x49, 0x46, 0x46].forEach((b, i) => (buf[i] = b)); // RIFF
    [0x57, 0x45, 0x42, 0x50].forEach((b, i) => (buf[8 + i] = b)); // WEBP
    expect(detectMimeFromMagicBytes(buf)).toBe("image/webp");
  });

  it("does NOT match RIFF without WEBP secondary signature", () => {
    const buf = makeBuffer([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]);
    expect(detectMimeFromMagicBytes(buf)).toBeNull();
  });

  it("detects GIF", () => {
    const buf = makeBuffer([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(detectMimeFromMagicBytes(buf)).toBe("image/gif");
  });

  it("detects PDF", () => {
    const buf = makeBuffer([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    expect(detectMimeFromMagicBytes(buf)).toBe("application/pdf");
  });

  it("detects AVIF (ftypavif at offset 4)", () => {
    const ftypavif = [0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66];
    const buf = makeBufferAt(4, ftypavif);
    expect(detectMimeFromMagicBytes(buf)).toBe("image/avif");
  });

  it("detects HEIC (ftypheic at offset 4)", () => {
    const ftypheic = [0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63];
    const buf = makeBufferAt(4, ftypheic);
    expect(detectMimeFromMagicBytes(buf)).toBe("image/heic");
  });

  it("detects WebM", () => {
    const buf = makeBuffer([0x1a, 0x45, 0xdf, 0xa3]);
    expect(detectMimeFromMagicBytes(buf)).toBe("video/webm");
  });

  it("detects QuickTime before generic MP4", () => {
    const ftypQuickTime = [0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20];
    const buf = makeBufferAt(4, ftypQuickTime);
    expect(detectMimeFromMagicBytes(buf)).toBe("video/quicktime");
  });

  it("detects ZIP", () => {
    const buf = makeBuffer([0x50, 0x4b, 0x03, 0x04]);
    expect(detectMimeFromMagicBytes(buf)).toBe("application/zip");
  });

  it("returns null for empty buffer", () => {
    expect(detectMimeFromMagicBytes(new Uint8Array(0))).toBeNull();
  });

  it("returns null for too-small buffer", () => {
    expect(detectMimeFromMagicBytes(new Uint8Array(4))).toBeNull();
  });

  it("returns null for unrecognized bytes", () => {
    const buf = makeBuffer([
      0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
    ]);
    expect(detectMimeFromMagicBytes(buf)).toBeNull();
  });
});

describe("validateBufferIntegrity", () => {
  it("returns valid=true when detected matches declared MIME", () => {
    const buf = makeBuffer([0xff, 0xd8, 0xff, 0xe0]);
    const result = validateBufferIntegrity(buf, "image/jpeg");
    expect(result.valid).toBe(true);
    expect(result.detectedMime).toBe("image/jpeg");
    expect(result.mismatch).toBe(false);
  });

  it("returns valid=false and mismatch=true when declared MIME differs", () => {
    const buf = makeBuffer([0xff, 0xd8, 0xff, 0xe0]);
    const result = validateBufferIntegrity(buf, "image/png");
    expect(result.valid).toBe(false);
    expect(result.detectedMime).toBe("image/jpeg");
    expect(result.mismatch).toBe(true);
  });

  it("returns valid=false when format is unrecognized", () => {
    const buf = makeBuffer([
      0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
    ]);
    const result = validateBufferIntegrity(buf, "image/jpeg");
    expect(result.valid).toBe(false);
    expect(result.detectedMime).toBeNull();
    expect(result.mismatch).toBe(false);
  });
});

describe("isAllowedImageType", () => {
  it.each(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"])(
    "allows %s",
    (mime) => {
      expect(isAllowedImageType(mime)).toBe(true);
    }
  );

  it.each(["image/heic", "application/pdf", "video/mp4", "text/html"])("rejects %s", (mime) => {
    expect(isAllowedImageType(mime)).toBe(false);
  });
});

describe("isAllowedDocType", () => {
  it("allows all image types", () => {
    expect(isAllowedDocType("image/jpeg")).toBe(true);
  });

  it("allows PDF", () => {
    expect(isAllowedDocType("application/pdf")).toBe(true);
  });

  it("rejects video", () => {
    expect(isAllowedDocType("video/mp4")).toBe(false);
  });
});
