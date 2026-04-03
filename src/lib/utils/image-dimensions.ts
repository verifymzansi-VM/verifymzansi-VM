/**
 * Extract image dimensions from raw file buffers by parsing format headers.
 * No external dependencies — works in both Node.js and Edge runtimes.
 */

export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Parse image dimensions from a buffer. Supports JPEG, PNG, and WebP.
 * Returns null if the format is unrecognized or the buffer is too short.
 */
export function getImageDimensions(buffer: Uint8Array): ImageDimensions | null {
  if (buffer.length < 8) return null;

  // JPEG: starts with 0xFFD8
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return getJpegDimensions(buffer);
  }

  // PNG: starts with 0x89504E47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return getPngDimensions(buffer);
  }

  // WebP: starts with RIFF....WEBP
  if (
    buffer[0] === 0x52 && // R
    buffer[1] === 0x49 && // I
    buffer[2] === 0x46 && // F
    buffer[3] === 0x46 && // F
    buffer[8] === 0x57 && // W
    buffer[9] === 0x45 && // E
    buffer[10] === 0x42 && // B
    buffer[11] === 0x50 // P
  ) {
    return getWebpDimensions(buffer);
  }

  return null;
}

function getJpegDimensions(buffer: Uint8Array): ImageDimensions | null {
  let offset = 2;

  while (offset < buffer.length - 1) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];

    // SOF markers (SOF0, SOF1, SOF2, SOF3, SOF5-SOF15)
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (offset + 9 > buffer.length) return null;
      const height = (buffer[offset + 5] << 8) | buffer[offset + 6];
      const width = (buffer[offset + 7] << 8) | buffer[offset + 8];
      return { width, height };
    }

    // Skip segment
    if (offset + 3 >= buffer.length) return null;
    const segLen = (buffer[offset + 2] << 8) | buffer[offset + 3];
    offset += 2 + segLen;
  }

  return null;
}

function getPngDimensions(buffer: Uint8Array): ImageDimensions | null {
  // IHDR chunk starts at byte 8, width at 16, height at 20 (big-endian)
  if (buffer.length < 24) return null;
  const width = ((buffer[16] << 24) | (buffer[17] << 16) | (buffer[18] << 8) | buffer[19]) >>> 0;
  const height = ((buffer[20] << 24) | (buffer[21] << 16) | (buffer[22] << 8) | buffer[23]) >>> 0;
  return { width, height };
}

function getWebpDimensions(buffer: Uint8Array): ImageDimensions | null {
  if (buffer.length < 30) return null;

  // VP8 (lossy)
  if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x20) {
    if (buffer.length < 30) return null;
    // Frame tag at offset 23, width at 26-27, height at 28-29 (little-endian, 14-bit)
    const width = (buffer[26] | (buffer[27] << 8)) & 0x3fff;
    const height = (buffer[28] | (buffer[29] << 8)) & 0x3fff;
    return { width, height };
  }

  // VP8L (lossless)
  if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x4c) {
    if (buffer.length < 25) return null;
    // Signature byte at 20, then 4 bytes at 21 encode width/height
    const bits = buffer[21] | (buffer[22] << 8) | (buffer[23] << 16) | (buffer[24] << 24);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height };
  }

  // VP8X (extended)
  if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x58) {
    if (buffer.length < 30) return null;
    const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
    const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
    return { width, height };
  }

  return null;
}
