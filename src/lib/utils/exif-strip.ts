/**
 * EXIF metadata stripping for uploaded images.
 *
 * Removes EXIF, XMP, and ICC profile data from JPEG files to prevent
 * leaking GPS coordinates, device info, and other PII (POPIA compliance).
 *
 * Only processes JPEG files — PNG/WebP/GIF/AVIF don't typically contain
 * sensitive EXIF data in the same way, and stripping them requires
 * format-specific handling that adds complexity without proportional benefit.
 */

/**
 * Strip EXIF/APP1 markers from a JPEG buffer.
 *
 * JPEG files consist of segments starting with 0xFF followed by a marker byte.
 * EXIF data lives in APP1 (0xFFE1) segments. This function removes all APP1
 * segments while preserving the image data and other necessary markers.
 */
export function stripExifFromJpeg(buffer: Uint8Array): Uint8Array {
  // Verify JPEG magic bytes
  if (buffer.length < 2 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return buffer; // Not a JPEG, return as-is
  }

  const result: number[] = [];

  // Copy SOI marker (Start of Image)
  result.push(0xff, 0xd8);

  let offset = 2;
  while (offset < buffer.length - 1) {
    // Find next marker
    if (buffer[offset] !== 0xff) {
      // We've hit the image data stream — copy the rest as-is
      for (let i = offset; i < buffer.length; i++) {
        result.push(buffer[i]);
      }
      break;
    }

    const marker = buffer[offset + 1];

    // End of markers — SOS (Start of Scan) means rest is image data
    if (marker === 0xda) {
      // Copy SOS and everything after it (compressed image data)
      for (let i = offset; i < buffer.length; i++) {
        result.push(buffer[i]);
      }
      break;
    }

    // Skip padding bytes (0xFF followed by 0xFF)
    if (marker === 0xff) {
      offset++;
      continue;
    }

    // Markers without length (RST0-RST7, SOI, EOI, TEM)
    if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
      result.push(0xff, marker);
      offset += 2;
      continue;
    }

    // Read segment length
    if (offset + 3 >= buffer.length) break;
    const segmentLength = (buffer[offset + 2] << 8) | buffer[offset + 3];
    if (segmentLength < 2) break;

    const segmentEnd = offset + 2 + segmentLength;

    // Skip APP1 (0xE1) — contains EXIF and XMP data
    // Skip APP2 (0xE2) — contains ICC profile (can contain PII)
    // Skip APP13 (0xED) — contains IPTC/Photoshop data
    if (marker === 0xe1 || marker === 0xe2 || marker === 0xed) {
      offset = segmentEnd;
      continue;
    }

    // Copy all other segments as-is
    for (let i = offset; i < segmentEnd && i < buffer.length; i++) {
      result.push(buffer[i]);
    }
    offset = segmentEnd;
  }

  return new Uint8Array(result);
}

/**
 * Check if a buffer is a JPEG file that may contain EXIF data.
 */
export function isJpegWithExif(buffer: Uint8Array): boolean {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return false;
  }

  // Check for APP1 marker (EXIF container)
  let offset = 2;
  while (offset < buffer.length - 1) {
    if (buffer[offset] !== 0xff) return false;
    const marker = buffer[offset + 1];

    if (marker === 0xe1) return true; // Found APP1
    if (marker === 0xda) return false; // Hit image data without finding APP1

    // Skip padding
    if (marker === 0xff) {
      offset++;
      continue;
    }

    // Markers without length
    if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
      offset += 2;
      continue;
    }

    // Skip segment
    if (offset + 3 >= buffer.length) return false;
    const segmentLength = (buffer[offset + 2] << 8) | buffer[offset + 3];
    if (segmentLength < 2) return false;
    offset += 2 + segmentLength;
  }

  return false;
}

// ── PNG metadata stripping ──────────────────────────────────────────────────

/** PNG magic bytes */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Ancillary chunk types that may contain PII (GPS, camera info, etc.) */
const PNG_PII_CHUNKS = new Set([
  "tEXt", // Uncompressed text (can hold EXIF-like data)
  "zTXt", // Compressed text
  "iTXt", // International text (XMP, EXIF tags)
  "eXIf", // EXIF data (PNG 1.5+)
]);

/**
 * Strip metadata chunks from a PNG buffer that may contain PII.
 *
 * PNG files are structured as: 8-byte signature + sequence of chunks.
 * Each chunk is: [4-byte length][4-byte type][data][4-byte CRC].
 * We copy all chunks except those in PNG_PII_CHUNKS.
 */
export function stripMetadataFromPng(buffer: Uint8Array): Uint8Array {
  // Verify PNG signature
  if (buffer.length < 8 || !PNG_SIGNATURE.every((b, i) => buffer[i] === b)) {
    return buffer; // Not a PNG, return as-is
  }

  const result: number[] = [];

  // Copy PNG signature
  for (let i = 0; i < 8; i++) {
    result.push(buffer[i]);
  }

  let offset = 8;
  while (offset + 12 <= buffer.length) {
    // Read chunk length (big-endian u32)
    const chunkLength =
      (buffer[offset] << 24) |
      (buffer[offset + 1] << 16) |
      (buffer[offset + 2] << 8) |
      buffer[offset + 3];

    // Read chunk type (4 ASCII bytes)
    const chunkType = String.fromCharCode(
      buffer[offset + 4],
      buffer[offset + 5],
      buffer[offset + 6],
      buffer[offset + 7]
    );

    // Total chunk size: 4 (length) + 4 (type) + data + 4 (CRC)
    const totalChunkSize = 12 + chunkLength;

    if (offset + totalChunkSize > buffer.length) break; // Truncated

    if (!PNG_PII_CHUNKS.has(chunkType)) {
      for (let i = offset; i < offset + totalChunkSize; i++) {
        result.push(buffer[i]);
      }
    }

    offset += totalChunkSize;

    // IEND marks end of PNG
    if (chunkType === "IEND") break;
  }

  return new Uint8Array(result);
}
