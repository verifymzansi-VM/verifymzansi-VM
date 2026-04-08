/**
 * Client-side BlurHash encoding utility.
 *
 * Generates a compact BlurHash string from an image File by drawing it
 * to a small canvas and encoding the pixel data. The resulting hash is
 * typically 20–30 characters and can be stored in the database alongside
 * the media record for use as an LQIP (Low Quality Image Placeholder).
 */

import { encode } from "blurhash";

/** Maximum dimension for the encoding canvas (keep it small for speed). */
const ENCODE_SIZE = 32;

/**
 * Generate a BlurHash string from an image File.
 * Returns null if encoding fails (e.g. CORS, unsupported format).
 *
 * @param file  - Image File (JPEG, PNG, WebP)
 * @param compX - Horizontal components (1–9, default 4)
 * @param compY - Vertical components (1–9, default 3)
 */
export function generateBlurHash(
  file: File,
  compX: number = 4,
  compY: number = 3
): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    const cleanup = () => {
      URL.revokeObjectURL(url);
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 8_000);

    img.addEventListener("load", () => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement("canvas");
        // Scale down to ENCODE_SIZE for fast encoding
        const scale = Math.min(ENCODE_SIZE / img.naturalWidth, ENCODE_SIZE / img.naturalHeight, 1);
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          cleanup();
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const hash = encode(imageData.data, imageData.width, imageData.height, compX, compY);
        cleanup();
        resolve(hash);
      } catch {
        cleanup();
        resolve(null);
      }
    });

    img.addEventListener("error", () => {
      clearTimeout(timer);
      cleanup();
      resolve(null);
    });

    img.src = url;
  });
}
