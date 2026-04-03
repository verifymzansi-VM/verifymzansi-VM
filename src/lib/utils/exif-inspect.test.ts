import { describe, expect, it } from "vitest";
import { inspectJpegExif } from "./exif-inspect";

// Minimal JPEG with no EXIF (SOI + SOS + EOI)
function makeMinimalJpeg(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
}

// Build a tiny JPEG with a valid EXIF APP1 segment
function makeJpegWithExif(tags: {
  model?: string;
  software?: string;
  dateTime?: string;
}): Uint8Array {
  const parts: number[] = [];

  // SOI
  parts.push(0xff, 0xd8);

  // Build EXIF APP1 segment
  const exifPayload = buildExifPayload(tags);
  const segLen = exifPayload.length + 2; // +2 for length field itself
  parts.push(0xff, 0xe1); // APP1 marker
  parts.push((segLen >> 8) & 0xff, segLen & 0xff);
  for (const b of exifPayload) parts.push(b);

  // SOS + EOI
  parts.push(0xff, 0xda, 0x00, 0x02, 0xff, 0xd9);

  return new Uint8Array(parts);
}

function buildExifPayload(tags: {
  model?: string;
  software?: string;
  dateTime?: string;
}): number[] {
  const buf: number[] = [];

  // "Exif\0\0"
  buf.push(0x45, 0x78, 0x69, 0x66, 0x00, 0x00);

  // TIFF header: little-endian, magic 0x002A, IFD0 offset = 8
  const _tiffStart = buf.length;
  buf.push(0x49, 0x49); // II
  buf.push(0x2a, 0x00); // magic LE
  buf.push(0x08, 0x00, 0x00, 0x00); // IFD0 offset = 8

  // IFD0 entries
  const entries: Array<{ tag: number; value: string }> = [];
  if (tags.model) entries.push({ tag: 0x0110, value: tags.model });
  if (tags.software) entries.push({ tag: 0x0131, value: tags.software });
  if (tags.dateTime) entries.push({ tag: 0x0132, value: tags.dateTime });

  // Sort by tag for TIFF spec
  entries.sort((a, b) => a.tag - b.tag);

  const numEntries = entries.length;
  buf.push(numEntries & 0xff, (numEntries >> 8) & 0xff);

  // Offset for string data: starts after IFD entries + next IFD pointer
  // IFD starts at tiffStart+8, each entry = 12 bytes, + 2 for count, + 4 for next IFD
  let stringDataOffset = 8 + 2 + numEntries * 12 + 4;

  const stringData: number[] = [];

  for (const entry of entries) {
    const strBytes = [...entry.value].map((c) => c.charCodeAt(0));
    strBytes.push(0); // null terminator
    const count = strBytes.length;

    // Tag (LE 16-bit)
    buf.push(entry.tag & 0xff, (entry.tag >> 8) & 0xff);
    // Type = 2 (ASCII)
    buf.push(0x02, 0x00);
    // Count (LE 32-bit)
    buf.push(count & 0xff, (count >> 8) & 0xff, (count >> 16) & 0xff, (count >> 24) & 0xff);

    if (count <= 4) {
      // Inline value
      for (let i = 0; i < 4; i++) {
        buf.push(i < strBytes.length ? strBytes[i] : 0);
      }
    } else {
      // Offset to string data (LE 32-bit, relative to TIFF start)
      const off = stringDataOffset + stringData.length;
      buf.push(off & 0xff, (off >> 8) & 0xff, (off >> 16) & 0xff, (off >> 24) & 0xff);
      stringData.push(...strBytes);
    }
  }

  // Next IFD pointer = 0
  buf.push(0x00, 0x00, 0x00, 0x00);

  // Append string data
  buf.push(...stringData);

  return buf;
}

describe("inspectJpegExif", () => {
  it("returns empty signals for non-JPEG buffer", () => {
    const result = inspectJpegExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect(result.hasExif).toBe(false);
    expect(result.cameraModel).toBeNull();
  });

  it("returns hasExif=false for JPEG without EXIF", () => {
    const result = inspectJpegExif(makeMinimalJpeg());
    expect(result.hasExif).toBe(false);
  });

  it("extracts camera model from EXIF", () => {
    const jpeg = makeJpegWithExif({ model: "iPhone 14 Pro" });
    const result = inspectJpegExif(jpeg);
    expect(result.hasExif).toBe(true);
    expect(result.cameraModel).toContain("iPhone 14 Pro");
  });

  it("extracts software field from EXIF", () => {
    const jpeg = makeJpegWithExif({ software: "Adobe Photoshop" });
    const result = inspectJpegExif(jpeg);
    expect(result.hasExif).toBe(true);
    expect(result.software).toBe("Adobe Photoshop");
  });

  it("extracts dateTime from EXIF", () => {
    const jpeg = makeJpegWithExif({ dateTime: "2026:03:15 10:30:00" });
    const result = inspectJpegExif(jpeg);
    expect(result.hasExif).toBe(true);
    expect(result.dateTime).toBe("2026:03:15 10:30:00");
  });

  it("handles empty buffer gracefully", () => {
    const result = inspectJpegExif(new Uint8Array(0));
    expect(result.hasExif).toBe(false);
  });
});
