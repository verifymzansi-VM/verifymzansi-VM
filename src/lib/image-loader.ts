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

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"]);

function withSizeQuery(src: string, width: number, quality: number): string {
  const [withoutHash, hash = ""] = src.split("#", 2);
  const base = withoutHash || src;
  const queryIndex = base.indexOf("?");
  const path = queryIndex >= 0 ? base.slice(0, queryIndex) : base;
  const query = queryIndex >= 0 ? base.slice(queryIndex + 1) : "";
  const params = new URLSearchParams(query);
  params.set("w", String(width));
  params.set("q", String(quality));
  const suffix = params.toString();
  return `${path}?${suffix}${hash ? `#${hash}` : ""}`;
}

function getPathWithoutHash(src: string): string {
  return src.split("#", 2)[0] || src;
}

function isImageSource(src: string): boolean {
  const path = getPathWithoutHash(src).split("?")[0] || "";
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(extension);
}

/**
 * When Cloudflare Image Resizing is disabled on the zone (or during local
 * development), the `/cdn-cgi/image/` endpoint returns 403/404 and every
 * image breaks. Toggle via `NEXT_PUBLIC_CF_IMAGE_RESIZING`.
 */
const CF_RESIZING_ENABLED = process.env.NEXT_PUBLIC_CF_IMAGE_RESIZING === "true";

const MEDIA_HOST = "media.verifymzansi.com";
const STAGING_MEDIA_HOST = "media-staging.verifymzansi.com";

export default function cloudflareImageLoader({ src, width, quality }: ImageLoaderParams): string {
  const resolvedQuality = quality || 75;

  // If Cloudflare Image Resizing is not available, return the src unchanged
  // so images still render (unoptimized but functional) while preserving
  // width-aware URLs required by Next.js custom loaders.
  if (!CF_RESIZING_ENABLED) {
    return withSizeQuery(src, width, resolvedQuality);
  }

  const cfParams = `width=${width},quality=${resolvedQuality},format=auto`;

  // Keep relative sources on the same origin so Cloudflare can negotiate AVIF/WebP
  // and right-size static homepage assets plus proxied media.
  if (!src.startsWith("http://") && !src.startsWith("https://")) {
    if (!isImageSource(src)) {
      return src;
    }
    return `/cdn-cgi/image/${cfParams}${getPathWithoutHash(src)}`;
  }

  // Absolute same-origin proxy URLs are image-resized at the edge when possible.
  if (src.includes("/api/media/serve/")) {
    try {
      const parsed = new URL(src);
      if (isImageSource(parsed.pathname)) {
        return `/cdn-cgi/image/${cfParams}${parsed.pathname}${parsed.search}`;
      }
    } catch {
      return src;
    }
    return src;
  }

  // Same-origin CDN URLs (media.verifymzansi.com) — extract the pathname
  // so Cloudflare can resize them via the zone's /cdn-cgi/image/ endpoint.
  try {
    const parsed = new URL(src);
    if (parsed.hostname === MEDIA_HOST || parsed.hostname === STAGING_MEDIA_HOST) {
      return `/cdn-cgi/image/${cfParams}${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // Not a valid absolute URL — return original src as a safe fallback.
    return src;
  }

  // Absolute remote URLs are left untouched. The current production zone can
  // resize same-origin paths, but remote sources like Unsplash return 404 when
  // routed through `/cdn-cgi/image/.../<absolute-url>`.
  if (src.startsWith("http://") || src.startsWith("https://")) {
    return withSizeQuery(src, width, resolvedQuality);
  }

  return withSizeQuery(src, width, resolvedQuality);
}
