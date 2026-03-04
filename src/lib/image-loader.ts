/**
 * Custom image loader for Cloudflare Pages / Workers.
 *
 * Cloudflare does not support the default Next.js `/_next/image` endpoint,
 * so we use a custom loader instead of setting `images.unoptimized: true`.
 *
 * If Cloudflare Image Resizing is enabled on the zone, this will
 * automatically produce optimised images via the `/cdn-cgi/image/` endpoint.
 * If it's not enabled, the URL passes through unchanged (same behaviour as
 * `unoptimized: true`, but with proper `srcset` / `sizes` attributes).
 *
 * @see https://developers.cloudflare.com/images/transform-images/transform-via-url/
 */

interface ImageLoaderParams {
  src: string;
  width: number;
  quality?: number;
}

/**
 * When Cloudflare Image Resizing is disabled on the zone (or during local
 * development), the `/cdn-cgi/image/` endpoint returns 403/404 and every
 * image breaks. Toggle via `NEXT_PUBLIC_CF_IMAGE_RESIZING`.
 */
const CF_RESIZING_ENABLED = process.env.NEXT_PUBLIC_CF_IMAGE_RESIZING === "true";

export default function cloudflareImageLoader({ src, width, quality }: ImageLoaderParams): string {
  // If Cloudflare Image Resizing is not available, return the src unchanged
  // so images still render (unoptimized but functional).
  if (!CF_RESIZING_ENABLED) {
    return src;
  }

  // Already an absolute URL (external image) — use Cloudflare's transform endpoint
  if (src.startsWith("http://") || src.startsWith("https://")) {
    const cfParams = `width=${width},quality=${quality || 75},format=auto`;
    return `/cdn-cgi/image/${cfParams}/${src}`;
  }

  // Relative URL (local asset) — transform via the same endpoint
  const cfParams = `width=${width},quality=${quality || 75},format=auto`;
  return `/cdn-cgi/image/${cfParams}${src}`;
}
