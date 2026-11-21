import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { qrCode, qrCodePngDataUrl } from "./qr-code";

const LINK = "https://verifymzansi.com/?ref=THANDO1";

/** Reads a 1-bit greyscale PNG back into its pixels (true = black), checking every chunk's CRC. */
function readPng(bytes: Buffer) {
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks: Record<string, Buffer> = {};
  const order: string[] = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString("latin1", at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(at + 4, at + 8 + length)) {
      crc ^= byte;
      for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    expect(bytes.readUInt32BE(at + 8 + length), `${type} CRC`).toBe((crc ^ 0xffffffff) >>> 0);
    chunks[type] = body;
    order.push(type);
    at += 12 + length;
  }
  expect(order).toEqual(["IHDR", "IDAT", "IEND"]);
  const header = chunks.IHDR!;
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  expect([...header.subarray(8)]).toEqual([1, 0, 0, 0, 0]);
  const raw = inflateSync(chunks.IDAT!);
  const rowBytes = 1 + Math.ceil(width / 8);
  expect(raw.length).toBe(rowBytes * height);
  const black = (x: number, y: number) => {
    expect(raw[y * rowBytes]).toBe(0);
    return ((raw[y * rowBytes + 1 + (x >> 3)]! >> (7 - (x & 7))) & 1) === 0;
  };
  return { width, height, black };
}

/** The dark squares of the QR code as a set of "x,y". */
function darkSquares(text: string) {
  const { path } = qrCode(text);
  return new Set([...path.matchAll(/M(\d+) (\d+)/g)].map((m) => `${m[1]},${m[2]}`));
}

describe("qrCode", () => {
  it("draws the text as dark squares on a square grid", () => {
    const { size, path } = qrCode(LINK);
    expect(size).toBeGreaterThanOrEqual(29);
    expect(path).toMatch(/^(M\d+ \d+h1v1h-1z)+$/);
  });
});

describe("qrCodePngDataUrl", () => {
  it("makes a PNG file, so phone galleries and WhatsApp show it", () => {
    const url = qrCodePngDataUrl(LINK);
    expect(url).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
  });

  it("draws the same QR code, black on white, 10 px a square", () => {
    const { size } = qrCode(LINK);
    const dark = darkSquares(LINK);
    const png = readPng(Buffer.from(qrCodePngDataUrl(LINK).split(",")[1]!, "base64"));
    expect(png.width).toBe(size * 10);
    expect(png.height).toBe(size * 10);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const want = dark.has(`${x},${y}`);
        // Every pixel of the square, corners included, has the square's colour.
        for (const [dx, dy] of [
          [0, 0],
          [9, 0],
          [0, 9],
          [9, 9],
          [5, 5],
        ] as const) {
          expect(png.black(x * 10 + dx, y * 10 + dy), `square ${x},${y}`).toBe(want);
        }
      }
    }
    // The quiet zone round the code is white.
    expect(png.black(0, 0)).toBe(false);
    expect(png.black(size * 10 - 1, size * 10 - 1)).toBe(false);
  });

  it("encodes a longer link too (a bigger code)", () => {
    const long = `${LINK}&utm_source=${"x".repeat(200)}`;
    const png = readPng(Buffer.from(qrCodePngDataUrl(long).split(",")[1]!, "base64"));
    expect(png.width).toBe(qrCode(long).size * 10);
  });
});
