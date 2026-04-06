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

const MEDIA_HOST = "media.verifymzansi.com";
const STAGING_MEDIA_HOST = "media-staging.verifymzansi.com";
const PROXY_MEDIA_PREFIX = "/api/media/serve/";

export default function cloudflareImageLoader({ src, width, quality }: ImageLoaderParams): string {
  // If Cloudflare Image Resizing is not available, return the src unchanged
  // so images still render (unoptimized but functional).
  if (!CF_RESIZING_ENABLED) {
    return src;
  }

  const cfParams = `width=${width},quality=${quality || 75},format=auto`;

  // Do not resize media-proxy API paths. Cloudflare Image Resizing can return
  // 404 when the source is an app route even if the source URL itself is 200.
  // Keep these paths direct so media always renders in production.
  if (src.startsWith(PROXY_MEDIA_PREFIX)) {
    return src;
  }

  // Keep other relative sources (static assets, app images) pass-through so
  // local/staging/prod render reliably even when /cdn-cgi/image is unavailable.
  if (!src.startsWith("http://") && !src.startsWith("https://")) {
    return src;
  }

  // Same-origin CDN URLs (media.verifymzansi.com) — extract the pathname
  // so Cloudflare can resize them via the zone's /cdn-cgi/image/ endpoint.
  try {
    const parsed = new URL(src);
    if (parsed.hostname === MEDIA_HOST || parsed.hostname === STAGING_MEDIA_HOST) {
      return `/cdn-cgi/image/${cfParams}${parsed.pathname}`;
    }
  } catch {
    // Not a valid absolute URL — return original src as a safe fallback.
    return src;
  }

  // Absolute remote URLs are left untouched. The current production zone can
  // resize same-origin paths, but remote sources like Unsplash return 404 when
  // routed through `/cdn-cgi/image/.../<absolute-url>`.
  if (src.startsWith("http://") || src.startsWith("https://")) {
    return src;
  }

  return src;
}
