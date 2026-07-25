/**
 * EXIF metadata stripping for uploaded images.
 *
 * Removes EXIF, XMP, and ICC profile data from JPEG files, PII text/EXIF
 * chunks from PNG files, and EXIF/XMP chunks from WebP files to prevent
 * leaking GPS coordinates, device info, and other PII (POPIA compliance).
 *
 * Only JPEG/PNG/WebP files are processed — GIF/AVIF don't typically contain
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

  const chunks: Uint8Array[] = [buffer.slice(0, 8)];
  let outputLength = 8;

  let offset = 8;
  while (offset + 12 <= buffer.length) {
    // Read chunk length (big-endian u32)
    const chunkLength =
      ((buffer[offset] << 24) |
        (buffer[offset + 1] << 16) |
        (buffer[offset + 2] << 8) |
        buffer[offset + 3]) >>>
      0;

    // Read chunk type (4 ASCII bytes)
    const chunkType = String.fromCharCode(
      buffer[offset + 4],
      buffer[offset + 5],
      buffer[offset + 6],
      buffer[offset + 7]
    );

    // Total chunk size: 4 (length) + 4 (type) + data + 4 (CRC)
    const totalChunkSize = 12 + chunkLength;

    if (chunkLength > buffer.length - offset - 12) break; // Truncated or corrupt

    if (!PNG_PII_CHUNKS.has(chunkType)) {
      const chunk = buffer.slice(offset, offset + totalChunkSize);
      chunks.push(chunk);
      outputLength += chunk.length;
    }

    offset += totalChunkSize;

    // IEND marks end of PNG
    if (chunkType === "IEND") break;
  }

  const result = new Uint8Array(outputLength);
  let writeOffset = 0;
  for (const chunk of chunks) {
    result.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }
  return result;
}

// ── WebP metadata stripping ─────────────────────────────────────────────────

/**
 * Strip EXIF/XMP chunks from a WebP buffer that may contain PII (GPS, camera
 * info, XMP sidecar data).
 *
 * WebP is a RIFF container: "RIFF" + u32le size + "WEBP" + chunks. Each chunk
 * is [4-byte FourCC][4-byte u32le size][data][1 pad byte when size is odd].
 * Extended files carry a VP8X chunk whose flags byte advertises the presence
 * of EXIF (bit 0x08) and XMP (bit 0x04) chunks — those chunks are removed and
 * the flags cleared so decoders don't look for metadata that is no longer
 * there. The RIFF size field is rewritten to match the new payload length.
 */
export function stripMetadataFromWebp(buffer: Uint8Array): Uint8Array {
  // Verify RIFF/WEBP container magic
  if (
    buffer.length < 12 ||
    buffer[0] !== 0x52 || // R
    buffer[1] !== 0x49 || // I
    buffer[2] !== 0x46 || // F
    buffer[3] !== 0x46 || // F
    buffer[8] !== 0x57 || // W
    buffer[9] !== 0x45 || // E
    buffer[10] !== 0x42 || // B
    buffer[11] !== 0x50 // P
  ) {
    return buffer; // Not a WebP, return as-is
  }

  const kept: Uint8Array[] = [];
  let keptLength = 0;

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkType = String.fromCharCode(
      buffer[offset],
      buffer[offset + 1],
      buffer[offset + 2],
      buffer[offset + 3]
    );
    const chunkSize =
      (buffer[offset + 4] |
        (buffer[offset + 5] << 8) |
        (buffer[offset + 6] << 16) |
        (buffer[offset + 7] << 24)) >>>
      0;

    if (chunkSize > buffer.length - offset - 8) break; // Truncated or corrupt

    // Chunks are padded to even sizes
    const totalChunkSize = 8 + chunkSize + (chunkSize % 2);

    if (chunkType !== "EXIF" && chunkType !== "XMP ") {
      const chunk = buffer.slice(offset, offset + totalChunkSize);
      if (chunkType === "VP8X" && chunkSize >= 1) {
        // Clear the EXIF (0x08) and XMP (0x04) feature flags
        chunk[8] &= ~(0x08 | 0x04);
      }
      kept.push(chunk);
      keptLength += chunk.length;
    }

    offset += totalChunkSize;
  }

  const result = new Uint8Array(12 + keptLength);
  result.set(buffer.slice(0, 12), 0);
  // Rewrite the RIFF size: "WEBP" (4 bytes) + kept chunks
  const riffSize = 4 + keptLength;
  result[4] = riffSize & 0xff;
  result[5] = (riffSize >> 8) & 0xff;
  result[6] = (riffSize >> 16) & 0xff;
  result[7] = (riffSize >>> 24) & 0xff;

  let writeOffset = 12;
  for (const chunk of kept) {
    result.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }
  return result;
}
