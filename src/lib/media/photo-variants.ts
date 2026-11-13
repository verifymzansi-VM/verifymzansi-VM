import "server-only";

import { getImageDimensions } from "../utils/image-dimensions";
import { resizeImageToWebp } from "../utils/image-reencode";
import { variantKeyFor } from "./variant-keys";

/**
 * Phone-sized copies of an uploaded photo (roadmap M4.3).
 *
 * After a photo is re-encoded and stored, one smaller WebP copy is stored
 * beside it at `<key>.w800.webp`. The image loader (src/lib/image-loader.ts)
 * asks for that copy for screens up to 800 px, and the media route serves the
 * original when a copy is missing, so photos uploaded before this change, or
 * whose copy failed or was skipped, still show. Photos uploaded while three
 * copies were made (pull request #217) also have 400 and 1600 px copies; the
 * 1600 px one is still served and all are deleted with their original
 * (VARIANT_WIDTHS in ./variant-keys.ts).
 *
 * Copies are made with the same free tools as the re-encode: the Cloudflare
 * Images binding on Workers, sharp in Node. Each copy is one Images
 * transformation (Images Free allows 5,000 a month, shared with the re-encode
 * every photo needs), so only the 800 px copy is made, only when the original
 * is wider, only while the monthly count is under the copy budget
 * (./images-allowance.ts), and `MEDIA_PHOTO_VARIANTS=off` stops making it
 * without a code change.
 */

/** The copy widths made at upload (the loader and cleanup know more). */
const MADE_VARIANT_WIDTHS = [800] as const;

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
  return MADE_VARIANT_WIDTHS.filter((width) => width < originalWidth);
}

/** The keys of the copies a photo of this width gets. */
export function variantKeysFor(objectKey: string, originalWidth: number): string[] {
  return variantWidthsFor(originalWidth).map((width) => variantKeyFor(objectKey, width));
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
