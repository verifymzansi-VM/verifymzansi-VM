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

export default function cloudflareImageLoader({ src, width, quality }: ImageLoaderParams): string {
  // Already an absolute URL (external image) — use Cloudflare's transform endpoint
  if (src.startsWith("http://") || src.startsWith("https://")) {
    // If the image is from our own media domain or Supabase, we can transform it
    // via Cloudflare Image Resizing (if enabled). Otherwise return as-is.
    const cfParams = `width=${width},quality=${quality || 75},format=auto`;
    return `/cdn-cgi/image/${cfParams}/${src}`;
  }

  // Relative URL (local asset) — transform via the same endpoint
  const cfParams = `width=${width},quality=${quality || 75},format=auto`;
  return `/cdn-cgi/image/${cfParams}${src}`;
}
