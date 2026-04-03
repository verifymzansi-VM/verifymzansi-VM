/**
 * EXIF metadata inspector for fraud detection signals.
 *
 * Reads (but does NOT modify) EXIF data from JPEG files to extract
 * fraud-relevant fields: camera model, date/time, and software.
 * Must be called BEFORE exif-strip.ts removes the data.
 */

export interface ExifSignals {
  hasExif: boolean;
  cameraModel: string | null;
  dateTime: string | null;
  software: string | null;
  orientation: number | null;
}

const EMPTY_SIGNALS: ExifSignals = {
  hasExif: false,
  cameraModel: null,
  dateTime: null,
  software: null,
  orientation: null,
};

// IFD0 tag IDs we care about
const TAG_ORIENTATION = 0x0112;
const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_SOFTWARE = 0x0131;
const TAG_DATE_TIME = 0x0132;

/**
 * Inspect JPEG EXIF data without modifying the buffer.
 * Returns fraud-relevant signals for the KYC engine.
 */
export function inspectJpegExif(buffer: Uint8Array): ExifSignals {
  // Verify JPEG magic bytes
  if (buffer.length < 2 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return EMPTY_SIGNALS;
  }

  // Scan for APP1 marker (0xFFE1)
  let offset = 2;
  while (offset < buffer.length - 3) {
    if (buffer[offset] !== 0xff) return EMPTY_SIGNALS;
    const marker = buffer[offset + 1];

    // SOS — no more metadata segments
    if (marker === 0xda) return EMPTY_SIGNALS;

    const segLen = (buffer[offset + 2] << 8) | buffer[offset + 3];

    if (marker === 0xe1) {
      // Found APP1 — check for "Exif\0\0" header
      if (
        offset + 10 < buffer.length &&
        buffer[offset + 4] === 0x45 && // E
        buffer[offset + 5] === 0x78 && // x
        buffer[offset + 6] === 0x69 && // i
        buffer[offset + 7] === 0x66 && // f
        buffer[offset + 8] === 0x00 &&
        buffer[offset + 9] === 0x00
      ) {
        return parseExifIfd(buffer, offset + 10, segLen - 8);
      }
      return EMPTY_SIGNALS;
    }

    offset += 2 + segLen;
  }

  return EMPTY_SIGNALS;
}

function parseExifIfd(buffer: Uint8Array, tiffStart: number, maxLen: number): ExifSignals {
  if (tiffStart + 8 > buffer.length) return EMPTY_SIGNALS;

  // Byte order: II (little-endian) or MM (big-endian)
  const isLE = buffer[tiffStart] === 0x49 && buffer[tiffStart + 1] === 0x49;
  const isBE = buffer[tiffStart] === 0x4d && buffer[tiffStart + 1] === 0x4d;
  if (!isLE && !isBE) return EMPTY_SIGNALS;

  const read16 = (off: number) =>
    isLE ? buffer[off] | (buffer[off + 1] << 8) : (buffer[off] << 8) | buffer[off + 1];

  const read32 = (off: number) =>
    isLE
      ? buffer[off] | (buffer[off + 1] << 8) | (buffer[off + 2] << 16) | (buffer[off + 3] << 24)
      : ((buffer[off] << 24) |
          (buffer[off + 1] << 16) |
          (buffer[off + 2] << 8) |
          buffer[off + 3]) >>>
        0;

  // Verify TIFF magic 0x002A
  if (read16(tiffStart + 2) !== 0x002a) return EMPTY_SIGNALS;

  const ifdOffset = read32(tiffStart + 4);
  const ifdAbsolute = tiffStart + ifdOffset;
  const endBound = tiffStart + maxLen;

  if (ifdAbsolute + 2 > buffer.length || ifdAbsolute + 2 > endBound) {
    return EMPTY_SIGNALS;
  }

  const numEntries = read16(ifdAbsolute);
  if (numEntries === 0 || numEntries > 200) return EMPTY_SIGNALS;

  let cameraModel: string | null = null;
  let dateTime: string | null = null;
  let software: string | null = null;
  let orientation: number | null = null;

  for (let i = 0; i < numEntries; i++) {
    const entryOff = ifdAbsolute + 2 + i * 12;
    if (entryOff + 12 > buffer.length || entryOff + 12 > endBound) break;

    const tag = read16(entryOff);
    const type = read16(entryOff + 2);
    const count = read32(entryOff + 4);

    if (tag === TAG_ORIENTATION && type === 3 && count === 1) {
      orientation = read16(entryOff + 8);
      continue;
    }

    // String tags (type 2 = ASCII)
    if (type === 2) {
      const strVal = readExifString(buffer, tiffStart, entryOff, count, read32, endBound);
      if (!strVal) continue;

      switch (tag) {
        case TAG_MAKE:
          // Combine make + model if both present
          cameraModel = cameraModel ? `${strVal} ${cameraModel}` : strVal;
          break;
        case TAG_MODEL:
          cameraModel = cameraModel ? `${cameraModel} ${strVal}` : strVal;
          break;
        case TAG_DATE_TIME:
          dateTime = strVal;
          break;
        case TAG_SOFTWARE:
          software = strVal;
          break;
      }
    }
  }

  return {
    hasExif: true,
    cameraModel,
    dateTime,
    software,
    orientation,
  };
}

function readExifString(
  buffer: Uint8Array,
  tiffStart: number,
  entryOff: number,
  count: number,
  read32: (off: number) => number,
  endBound: number
): string | null {
  if (count < 1 || count > 1024) return null;

  let strStart: number;
  if (count <= 4) {
    // Value is inline in the entry
    strStart = entryOff + 8;
  } else {
    // Value offset is relative to TIFF start
    const valOffset = read32(entryOff + 8);
    strStart = tiffStart + valOffset;
  }

  if (strStart + count > buffer.length || strStart + count > endBound) {
    return null;
  }

  // Read ASCII, strip null terminator
  const bytes = buffer.slice(strStart, strStart + count);
  let str = "";
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) break;
    str += String.fromCharCode(bytes[i]);
  }
  return str.trim() || null;
}
