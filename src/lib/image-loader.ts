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

/**
 * Pre-generated variant widths (must match VARIANT_WIDTHS in
 * src/lib/services/image-variants.ts). Cloudflare Image Resizing is not
 * enabled on the zone, so responsive delivery relies on variants generated
 * at upload time. The loader maps a requested width to the nearest variant
 * key; the serve route falls back to the original when the variant object
 * does not exist yet (e.g. media uploaded before variants were introduced).
 */
const VARIANT_WIDTHS = [400, 800, 1600] as const;

/** Pick the smallest variant width that is >= the requested width. */
function nearestVariantWidth(requestedWidth: number): number {
  for (const w of VARIANT_WIDTHS) {
    if (w >= requestedWidth) return w;
  }
  return VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1];
}

/**
 * Rewrite a media proxy path to its pre-generated variant key for the
 * requested width. `/api/media/serve/media/x.jpg` @ 640 →
 * `/api/media/serve/media/x.w800.webp`. Returns the original path unchanged
 * when it is already a variant key or not a resizable image.
 */
function toVariantProxyPath(path: string, requestedWidth: number): string {
  // Already a variant key — don't double-rewrite.
  if (/\.w\d+\.webp$/.test(path)) return path;
  if (!isImageSource(path)) return path;
  const servePrefix = "/api/media/serve/";
  if (!path.startsWith(servePrefix)) return path;
  const key = path.slice(servePrefix.length);
  const dot = key.lastIndexOf(".");
  if (dot <= 0) return path;
  const stem = key.slice(0, dot);
  const width = nearestVariantWidth(requestedWidth);
  return `${servePrefix}${stem}.w${width}.webp`;
}

export default function cloudflareImageLoader({ src, width, quality }: ImageLoaderParams): string {
  const resolvedQuality = quality || 75;

  // If Cloudflare Image Resizing is not available, return the src unchanged
  // so images still render (unoptimized but functional) while preserving
  // width-aware URLs required by Next.js custom loaders.
  if (!CF_RESIZING_ENABLED) {
    return withSizeQuery(src, width, resolvedQuality);
  }

  const cfParams = `width=${width},quality=${resolvedQuality},format=auto`;

  // Keep same-origin relative assets on their native paths. Production is able
  // to serve these directly, while rewriting them through `/cdn-cgi/image/`
  // currently returns 404s for both `/images/*` and `/api/media/serve/*`.
  // Verified 2026-08-08: the verifymzansi.com zone does NOT have Cloudflare
  // Image Resizing enabled — /cdn-cgi/image/ returns 404 for proxy paths.
  //
  // Instead, media proxy images are rewritten to a pre-generated variant key
  // sized to the requested width (upload-time WebP variants). The serve route
  // falls back to the original object when the variant does not exist yet.
  if (!src.startsWith("http://") && !src.startsWith("https://")) {
    if (src.startsWith("/api/media/serve/")) {
      return toVariantProxyPath(src, width);
    }
    if (!isImageSource(src)) {
      return src;
    }
    return withSizeQuery(src, width, resolvedQuality);
  }

  // Absolute proxy URLs: resize via pre-generated variant keys, leave videos
  // and non-image assets on the proxy path untouched.
  if (src.includes("/api/media/serve/")) {
    try {
      const parsed = new URL(src);
      if (isImageSource(parsed.pathname)) {
        return toVariantProxyPath(parsed.pathname, width);
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
