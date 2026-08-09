/**
 * Server-side responsive image variant generation.
 *
 * Cloudflare Image Resizing is NOT enabled on the verifymzansi.com zone
 * (verified 2026-08-08 — /cdn-cgi/image/ returns 404), so we cannot resize
 * on-the-fly at the edge. Instead we generate resized WebP variants at upload
 * time and store them alongside the original in R2. The custom image loader
 * then maps a requested width to the nearest variant key, so mobile devices
 * download a small variant instead of the full-resolution original.
 *
 * Uses sharp (already a dependency). Follows the same graceful-fallback
 * pattern as perceptual-hash.ts: if sharp is unavailable or decoding fails,
 * variant generation is skipped and the original is served.
 */

/** Variant widths (pixels on the long edge) generated at upload time. */
export const VARIANT_WIDTHS = [400, 800, 1600] as const;

/** WebP quality per variant width. */
const VARIANT_QUALITY: Record<number, number> = {
  400: 80,
  800: 82,
  1600: 85,
};

export interface GeneratedVariant {
  /** Width on the long edge. */
  width: number;
  /** R2 storage key for the variant. */
  key: string;
  /** Resized image bytes (WebP). */
  buffer: Buffer;
}

/**
 * Derive the R2 key for a variant of a given original key.
 * `media/listing/u/123-abc.jpg` + width 400 → `media/listing/u/123-abc.w400.webp`
 */
export function variantKeyFor(originalKey: string, width: number): string {
  const dot = originalKey.lastIndexOf(".");
  const stem = dot > 0 ? originalKey.slice(0, dot) : originalKey;
  return `${stem}.w${width}.webp`;
}

/**
 * Parse a variant key back to its original key + width, or null if the key is
 * not a recognized variant. Used by the loader to avoid double-rewriting.
 */
export function parseVariantKey(key: string): { originalKey: string; width: number } | null {
  const match = key.match(/^(.*)\.w(\d+)\.webp$/);
  if (!match) return null;
  return { originalKey: match[1], width: parseInt(match[2], 10) };
}

/**
 * Generate resized WebP variants for an image buffer.
 *
 * Only generates variants smaller than the source — a 500px-wide source image
 * produces only the 400w variant (upscaling would waste bytes). Returns an
 * empty array when sharp is unavailable or the buffer cannot be decoded, so
 * callers can treat variant generation as best-effort.
 *
 * @param buffer      - Raw image bytes (post EXIF/metadata strip).
 * @param originalKey - The R2 key the original was (or will be) stored under.
 */
export async function generateImageVariants(
  buffer: Buffer,
  originalKey: string
): Promise<GeneratedVariant[]> {
  try {
    const sharpMod = await import("sharp").catch(() => null);
    if (!sharpMod) return [];
    const sharp = sharpMod.default ?? sharpMod;

    const image = sharp(buffer, { failOn: "none" }).rotate(); // normalize EXIF orientation
    const meta = await image.metadata();
    const srcWidth = meta.width ?? 0;
    const srcHeight = meta.height ?? 0;
    if (srcWidth === 0 || srcHeight === 0) return [];

    const longEdge = Math.max(srcWidth, srcHeight);
    const variants: GeneratedVariant[] = [];

    for (const width of VARIANT_WIDTHS) {
      // Skip variants that would upscale the source.
      if (width >= longEdge) continue;

      // Constrain the LONG edge so portrait and landscape images are both
      // downscaled to the target size. `resize({ width })` alone would leave a
      // portrait image's height (the long edge) untouched, producing a
      // full-size file mislabeled as a small variant.
      const resized = await sharp(buffer, { failOn: "none" })
        .rotate()
        .resize({
          width: srcWidth >= srcHeight ? width : undefined,
          height: srcHeight > srcWidth ? width : undefined,
          withoutEnlargement: true,
        })
        .webp({ quality: VARIANT_QUALITY[width] ?? 82 })
        .toBuffer();

      variants.push({ width, key: variantKeyFor(originalKey, width), buffer: resized });
    }

    return variants;
  } catch {
    // sharp unavailable or undecodable image — serve the original.
    return [];
  }
}
