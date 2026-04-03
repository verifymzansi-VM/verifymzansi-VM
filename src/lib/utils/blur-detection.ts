/**
 * Blur detection via Laplacian variance on grayscale image data.
 *
 * Works on raw pixel buffers (RGBA). The caller is responsible for
 * decoding the image into pixels — this module only computes the
 * Laplacian variance score.
 *
 * A lower score indicates a blurrier image. Typical threshold: 100.
 */

/**
 * Decode a JPEG/PNG buffer into raw RGBA pixels using OffscreenCanvas.
 * Returns null if decoding fails or the API is unavailable (Edge runtime).
 */
export async function decodeImageToPixels(
  buffer: Uint8Array,
  _mimeType: string
): Promise<{ data: Uint8ClampedArray; width: number; height: number } | null> {
  // Node.js: use sharp if available, otherwise skip
  try {
    // Dynamic import to avoid bundling sharp in client
    const sharp = await import("sharp").catch(() => null);
    if (sharp) {
      const img = sharp.default(Buffer.from(buffer));
      const metadata = await img.metadata();
      if (!metadata.width || !metadata.height) return null;

      // Downscale large images for performance (max 512px on longest side)
      const maxSide = Math.max(metadata.width, metadata.height);
      const scale = maxSide > 512 ? 512 / maxSide : 1;
      const w = Math.round(metadata.width * scale);
      const h = Math.round(metadata.height * scale);

      const raw = await img.resize(w, h, { fit: "inside" }).ensureAlpha().raw().toBuffer();

      return { data: new Uint8ClampedArray(raw), width: w, height: h };
    }
  } catch {
    // sharp not available — skip blur detection
  }
  return null;
}

/**
 * Compute Laplacian variance on grayscale channel of RGBA pixel data.
 * Returns a numeric score — lower = blurrier.
 */
export function computeLaplacianVariance(
  data: Uint8ClampedArray,
  width: number,
  height: number
): number {
  if (width < 3 || height < 3) return Infinity;

  // Convert to grayscale
  const gray = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // Apply 3×3 Laplacian kernel [0,1,0; 1,-4,1; 0,1,0]
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const lap =
        gray[idx - width] + gray[idx - 1] + gray[idx + 1] + gray[idx + width] - 4 * gray[idx];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }

  if (count === 0) return Infinity;

  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  return variance;
}
