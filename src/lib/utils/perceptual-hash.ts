/**
 * Perceptual image hashing (dHash) for near-duplicate detection.
 *
 * Produces a 64-bit difference hash as a 16-char hex string.
 * Near-duplicate images (cropped, slightly edited, re-compressed)
 * produce hashes with low Hamming distance (≤10).
 *
 * Uses sharp for resizing (best-effort); returns null if unavailable.
 */

/** Hamming distance between two hex hash strings. */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Infinity;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const xor = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    // Count set bits (Brian Kernighan's)
    let bits = xor;
    while (bits) {
      bits &= bits - 1;
      dist++;
    }
  }
  return dist;
}

/** Maximum Hamming distance to consider images as near-duplicates. */
export const PHASH_SIMILARITY_THRESHOLD = 10;

/**
 * Compute a 64-bit dHash (difference hash) from a raw image buffer.
 *
 * 1. Resize to 9×8 grayscale (using sharp)
 * 2. Compare each pixel to its right neighbor
 * 3. Encode the 8×8 comparison grid as 64 bits → 16 hex chars
 *
 * Returns null if sharp is unavailable or the image cannot be decoded.
 */
export async function computePerceptualHash(buffer: Buffer): Promise<string | null> {
  try {
    // Dynamic import — sharp may not be available in all environments
    const sharpMod = await import("sharp").catch(() => null);
    if (!sharpMod) return null;

    const sharp = sharpMod.default ?? sharpMod;

    // Resize to 9 wide × 8 tall, grayscale, no alpha
    const pixels = await sharp(buffer)
      .resize(9, 8, { fit: "fill" })
      .grayscale()
      .removeAlpha()
      .raw()
      .toBuffer();

    if (pixels.length < 72) return null; // 9×8 = 72 bytes

    // Build 64-bit hash: for each row, compare pixel[col] < pixel[col+1]
    let hash = "";
    for (let row = 0; row < 8; row++) {
      let byte = 0;
      for (let col = 0; col < 8; col++) {
        const idx = row * 9 + col;
        if (pixels[idx] < pixels[idx + 1]) {
          byte |= 1 << (7 - col);
        }
      }
      hash += byte.toString(16).padStart(2, "0");
    }

    return hash;
  } catch {
    return null;
  }
}
