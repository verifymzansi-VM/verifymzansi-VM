import { describe, expect, it } from "vitest";
import { getImageDimensions } from "./image-dimensions";

function makeJpeg(width: number, height: number): Uint8Array {
  // Minimal JPEG: SOI + SOF0 with dimensions + SOS + EOI
  return new Uint8Array([
    0xff,
    0xd8, // SOI
    0xff,
    0xc0, // SOF0
    0x00,
    0x0b, // segment length = 11
    0x08, // precision
    (height >> 8) & 0xff,
    height & 0xff, // height BE
    (width >> 8) & 0xff,
    width & 0xff, // width BE
    0x01, // num components
    0x01,
    0x11,
    0x00, // component info
    0xff,
    0xda, // SOS
    0x00,
    0x02, // segment length
    0xff,
    0xd9, // EOI
  ]);
}

function makePng(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(30);
  // PNG signature
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // IHDR chunk length (13 bytes)
  buf.set([0x00, 0x00, 0x00, 0x0d], 8);
  // "IHDR"
  buf.set([0x49, 0x48, 0x44, 0x52], 12);
  // Width (BE 32-bit)
  buf[16] = (width >> 24) & 0xff;
  buf[17] = (width >> 16) & 0xff;
  buf[18] = (width >> 8) & 0xff;
  buf[19] = width & 0xff;
  // Height (BE 32-bit)
  buf[20] = (height >> 24) & 0xff;
  buf[21] = (height >> 16) & 0xff;
  buf[22] = (height >> 8) & 0xff;
  buf[23] = height & 0xff;
  return buf;
}

describe("getImageDimensions", () => {
  it("parses JPEG dimensions", () => {
    const result = getImageDimensions(makeJpeg(1280, 720));
    expect(result).toEqual({ width: 1280, height: 720 });
  });

  it("parses PNG dimensions", () => {
    const result = getImageDimensions(makePng(800, 600));
    expect(result).toEqual({ width: 800, height: 600 });
  });

  it("returns null for unknown format", () => {
    const result = getImageDimensions(new Uint8Array([0x00, 0x01, 0x02, 0x03]));
    expect(result).toBeNull();
  });

  it("returns null for empty buffer", () => {
    const result = getImageDimensions(new Uint8Array(0));
    expect(result).toBeNull();
  });

  it("handles small JPEG dimensions", () => {
    const result = getImageDimensions(makeJpeg(320, 240));
    expect(result).toEqual({ width: 320, height: 240 });
  });

  it("handles large PNG dimensions", () => {
    const result = getImageDimensions(makePng(4000, 3000));
    expect(result).toEqual({ width: 4000, height: 3000 });
  });
});
