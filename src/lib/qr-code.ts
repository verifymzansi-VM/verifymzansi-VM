import { encode } from "uqr";

/** The QR code's squares, quiet zone included: `true` is a dark square. */
function qrModules(text: string) {
  return encode(text, { ecc: "M", border: 4 }).data;
}

/**
 * A QR code drawn by the website's server: one SVG path of dark squares on a
 * `size` x `size` grid (quiet zone included). No third-party service or script
 * sees the text it holds.
 */
export function qrCode(text: string) {
  const data = qrModules(text);
  const size = data.length;
  let path = "";
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x} ${y}h1v1h-1z`;
    })
  );
  return { size, path };
}

/**
 * The same QR code as a PNG file (black on white, `scale` px a square), which
 * phone galleries and WhatsApp show (they do not show SVG files). A 1-bit
 * greyscale image; its pixels are stored uncompressed, so no compression
 * library is needed.
 */
function qrCodePng(text: string, scale = 10): Uint8Array {
  const data = qrModules(text);
  const width = data.length * scale;
  const rowBytes = 1 + Math.ceil(width / 8); // filter byte "none", then 8 pixels a byte
  const pixels = new Uint8Array(rowBytes * width);
  for (let y = 0; y < width; y++) {
    const row = data[Math.floor(y / scale)]!;
    for (let x = 0; x < width; x++) {
      // In 1-bit greyscale, 1 is white; a dark square leaves its bit 0.
      if (!row[Math.floor(x / scale)]) pixels[y * rowBytes + 1 + (x >> 3)]! |= 0x80 >> (x & 7);
    }
    // Padding bits past the last pixel stay white.
    for (let x = width; x < (rowBytes - 1) * 8; x++) {
      pixels[y * rowBytes + 1 + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, width);
  header.set([1, 0, 0, 0, 0], 8); // bit depth 1, greyscale, deflate, no filter, no interlace

  return concat([
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlibStored(pixels)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

/** A zlib stream of uncompressed ("stored") deflate blocks. */
function zlibStored(bytes: Uint8Array) {
  const parts: Uint8Array[] = [Uint8Array.of(0x78, 0x01)];
  for (let at = 0; at < bytes.length; at += 0xffff) {
    const block = bytes.subarray(at, at + 0xffff);
    const last = at + 0xffff >= bytes.length ? 1 : 0;
    const head = new Uint8Array(5);
    head[0] = last;
    new DataView(head.buffer).setUint16(1, block.length, true);
    new DataView(head.buffer).setUint16(3, ~block.length & 0xffff, true);
    parts.push(head, block);
  }
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const adler = new Uint8Array(4);
  new DataView(adler.buffer).setUint32(0, ((b << 16) | a) >>> 0);
  parts.push(adler);
  return concat(parts);
}

function pngChunk(type: string, body: Uint8Array) {
  const chunk = new Uint8Array(12 + body.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(body, 8);
  view.setUint32(8 + body.length, crc32(chunk.subarray(4, 8 + body.length)));
  return chunk;
}

let crcTable: Uint32Array | undefined;

function crc32(bytes: Uint8Array) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * The same QR code as a PNG file (black on white, 10 px a square) in a `data:`
 * link the browser downloads without another request.
 */
export function qrCodePngDataUrl(text: string) {
  let binary = "";
  for (const byte of qrCodePng(text)) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}
