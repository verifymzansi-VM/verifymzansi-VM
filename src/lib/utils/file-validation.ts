/**
 * File validation utilities.
 * Detects MIME types from magic bytes and validates file integrity.
 */

/** Known magic byte signatures */
const MAGIC_SIGNATURES: Array<{
  mime: string;
  bytes: number[];
  offset?: number;
}> = [
  // JPEG: FF D8 FF
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // WebP: RIFF....WEBP (bytes 0-3 = RIFF, bytes 8-11 = WEBP)
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] },
  // GIF: GIF87a or GIF89a — first 4 bytes "GIF8"
  { mime: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  // AVIF: ISO BMFF with "ftypavif" at offset 4 (must be before MP4)
  { mime: "image/avif", bytes: [0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], offset: 4 },
  // AVIF sequence: ISO BMFF with "ftypavis" at offset 4
  { mime: "image/avif", bytes: [0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x73], offset: 4 },
  // HEIC: ISO BMFF with "ftypheic" at offset 4
  { mime: "image/heic", bytes: [0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], offset: 4 },
  // HEIF: ISO BMFF with "ftypmif1" at offset 4
  { mime: "image/heif", bytes: [0x66, 0x74, 0x79, 0x70, 0x6d, 0x69, 0x66, 0x31], offset: 4 },
  // HEIC sequence: ISO BMFF with "ftypheix" at offset 4
  { mime: "image/heic", bytes: [0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x78], offset: 4 },
  // PDF: %PDF
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] },
  // MP4 / QuickTime: bytes 4-7 = "ftyp" (ISO base media file, covers mp4 & mov)
  { mime: "video/mp4", bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  // WebM: bytes 0-3 = 0x1A45DFA3 (EBML header, covers WebM/Matroska)
  { mime: "video/webm", bytes: [0x1a, 0x45, 0xdf, 0xa3] },
  // ZIP: PK\x03\x04
  { mime: "application/zip", bytes: [0x50, 0x4b, 0x03, 0x04] },
];

/** WebP secondary signature at offset 8 */
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50]; // "WEBP"

/**
 * Detect MIME type from the first bytes of a file buffer.
 * Returns null if the format is not recognized.
 */
export function detectMimeFromMagicBytes(buffer: Buffer | Uint8Array): string | null {
  if (!buffer || buffer.length < 12) {
    return null;
  }

  for (const sig of MAGIC_SIGNATURES) {
    const offset = sig.offset ?? 0;
    let match = true;

    for (let i = 0; i < sig.bytes.length; i++) {
      if (buffer[offset + i] !== sig.bytes[i]) {
        match = false;
        break;
      }
    }

    if (match) {
      // Special case: WebP needs secondary check at offset 8
      if (sig.mime === "image/webp") {
        let webpMatch = true;
        for (let i = 0; i < WEBP_SIGNATURE.length; i++) {
          if (buffer[8 + i] !== WEBP_SIGNATURE[i]) {
            webpMatch = false;
            break;
          }
        }
        if (!webpMatch) continue; // RIFF but not WebP — skip
      }

      return sig.mime;
    }
  }

  return null;
}

/**
 * Validate file integrity by comparing magic bytes against declared MIME type.
 */
async function _validateFileIntegrity(
  file: File | Blob,
  declaredMime: string
): Promise<{
  valid: boolean;
  detectedMime: string | null;
  mismatch: boolean;
}> {
  const headerBytes = await readFileHeader(file, 12);
  const detectedMime = detectMimeFromMagicBytes(headerBytes);

  const mismatch = detectedMime !== null && detectedMime !== declaredMime;

  return {
    valid: detectedMime !== null && !mismatch,
    detectedMime,
    mismatch,
  };
}

/**
 * Validate file integrity from a Buffer (server-side).
 */
export function validateBufferIntegrity(
  buffer: Buffer | Uint8Array,
  declaredMime: string
): {
  valid: boolean;
  detectedMime: string | null;
  mismatch: boolean;
} {
  const detectedMime = detectMimeFromMagicBytes(buffer);
  const mismatch = detectedMime !== null && detectedMime !== declaredMime;

  return {
    valid: detectedMime !== null && !mismatch,
    detectedMime,
    mismatch,
  };
}

/**
 * Read the first N bytes of a File/Blob for magic byte detection.
 */
async function readFileHeader(file: File | Blob, bytes: number): Promise<Uint8Array> {
  const slice = file.slice(0, bytes);
  const arrayBuffer = await slice.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

/**
 * Check if a MIME type is an allowed image type.
 */
export function isAllowedImageType(mime: string): boolean {
  return ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"].includes(mime);
}

/**
 * Check if a MIME type is an allowed document type (images + PDF).
 */
export function isAllowedDocType(mime: string): boolean {
  return isAllowedImageType(mime) || mime === "application/pdf";
}
