import "server-only";

import { getImageDimensions } from "../utils/image-dimensions";
import { resizeImageToWebp } from "../utils/image-reencode";
import { VARIANT_WIDTHS, variantKeyFor } from "./variant-keys";

/**
 * Phone-sized copies of an uploaded photo (roadmap M4.3).
 *
 * After a photo is re-encoded and stored, smaller WebP copies are stored
 * beside it at `<key>.w400.webp`, `<key>.w800.webp` and `<key>.w1600.webp`.
 * The image loader (src/lib/image-loader.ts) asks for the copy that fits the
 * screen, and the media route serves the original when a copy is missing, so
 * photos uploaded before this change, or whose copies failed, still show.
 *
 * Copies are made with the same free tools as the re-encode: the Cloudflare
 * Images binding on Workers, sharp in Node. Each copy is one Images
 * transformation (Images Free allows 5,000 a month, shared with the
 * re-encode), so only copies narrower than the original are made, and
 * `MEDIA_PHOTO_VARIANTS=off` stops making them without a code change.
 */

interface PhotoVariant {
  key: string;
  width: number;
  bytes: Uint8Array;
}

/** Copies are made unless the Worker setting MEDIA_PHOTO_VARIANTS is "off". */
export function photoVariantsEnabled(environment: Record<string, string | undefined>): boolean {
  return environment.MEDIA_PHOTO_VARIANTS?.trim().toLowerCase() !== "off";
}

/** The copy widths worth making: narrower than the original, never enlarged. */
export function variantWidthsFor(originalWidth: number): number[] {
  return VARIANT_WIDTHS.filter((width) => width < originalWidth);
}

/**
 * Make the copies of a stored (already re-encoded) photo. Never throws: a
 * copy that fails, comes out the wrong size or is not smaller than the
 * original is left out, and the media route serves the original instead.
 */
export async function createPhotoVariants(
  objectKey: string,
  original: Uint8Array,
  originalWidth: number
): Promise<PhotoVariant[]> {
  const made = await Promise.allSettled(
    variantWidthsFor(originalWidth).map(async (width) => {
      const bytes = await resizeImageToWebp(original, width);
      const size = getImageDimensions(bytes);
      if (!size || Math.abs(size.width - width) > 1 || bytes.length >= original.length) return null;
      return { key: variantKeyFor(objectKey, width), width, bytes };
    })
  );
  return made.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : []
  );
}
