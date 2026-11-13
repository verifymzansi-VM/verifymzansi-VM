/**
 * Custom image loader for Cloudflare Workers.
 *
 * Cloudflare does not support the default Next.js `/_next/image` endpoint,
 * so we use a custom loader instead of setting `images.unoptimized: true`.
 *
 * Media proxy paths ask for a pre-generated WebP variant key; the media route
 * serves the original file when that variant does not exist. Nothing is
 * resized on the fly: the zone has no Cloudflare Image Resizing, so this
 * loader never builds `/cdn-cgi/image/` URLs. Other images keep their source
 * URL, with width/quality query parameters added.
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
 * Despite its name, NEXT_PUBLIC_CF_IMAGE_RESIZING does not turn on any
 * resizing. When "true" (production), same-origin paths without an image
 * extension are returned unchanged instead of gaining width/quality query
 * parameters. Media variants never depend on it.
 */
const CF_RESIZING_ENABLED = process.env.NEXT_PUBLIC_CF_IMAGE_RESIZING === "true";

/**
 * Pre-generated variant widths (must match VARIANT_WIDTHS in
 * src/lib/media/variant-keys.ts). Cloudflare Image Resizing is not
 * enabled on the zone, so responsive delivery relies on variants generated
 * at upload time. The loader maps a requested width to the nearest variant
 * key; the serve route falls back to the original when the variant object
 * does not exist (photos uploaded before the copies were made, copies that
 * failed, and widths not smaller than the original).
 */
const VARIANT_WIDTHS = [400, 800, 1600] as const;

/** A photo or video key made by the live backend's upload: `media/<uuid>`. */
const LIVE_MEDIA_KEY = /^media\/[0-9a-f-]{36}$/;

/** Pick the smallest variant width that is >= the requested width. */
function nearestVariantWidth(requestedWidth: number): number {
  for (const w of VARIANT_WIDTHS) {
    if (w >= requestedWidth) return w;
  }
  return VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1];
}

/**
 * Live-backend photos get only the 800 px copy at upload now (each copy uses
 * the free monthly Cloudflare Images allowance; src/lib/media/photo-variants.ts),
 * so small screens ask for it too instead of a 400 px copy that newer photos do
 * not have. Wider screens still ask for the 1600 px copy, which photos uploaded
 * while three copies were made have; the others fall back to the original.
 */
function liveMediaVariantWidth(requestedWidth: number): number {
  return requestedWidth <= 800 ? 800 : 1600;
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
  const servePrefix = "/api/media/serve/";
  if (!path.startsWith(servePrefix)) return path;
  const key = path.slice(servePrefix.length);
  // Keys made by the live backend (`media/<uuid>`) have no extension; their
  // copies are `media/<uuid>.w<width>.webp` (src/lib/media/photo-variants.ts).
  if (LIVE_MEDIA_KEY.test(key)) {
    return `${servePrefix}${key}.w${liveMediaVariantWidth(requestedWidth)}.webp`;
  }
  if (!isImageSource(path)) return path;
  const dot = key.lastIndexOf(".");
  if (dot <= 0) return path;
  const stem = key.slice(0, dot);
  const width = nearestVariantWidth(requestedWidth);
  return `${servePrefix}${stem}.w${width}.webp`;
}

export default function cloudflareImageLoader({ src, width, quality }: ImageLoaderParams): string {
  const resolvedQuality = quality || 75;

  // The media proxy can always serve a pre-generated variant, falling back to
  // its original when that variant is absent. Keep this path independent of
  // Cloudflare Image Resizing so SSR preloads match hydrated image URLs.
  if (src.startsWith("/api/media/serve/")) {
    return toVariantProxyPath(src, width);
  }
  if (src.startsWith("http://") || src.startsWith("https://")) {
    try {
      const parsed = new URL(src);
      if (parsed.pathname.startsWith("/api/media/serve/")) {
        return toVariantProxyPath(parsed.pathname, width);
      }
    } catch {
      return src;
    }
  }

  // Same-origin paths without an image extension stay untouched in production
  // (see CF_RESIZING_ENABLED above).
  if (
    CF_RESIZING_ENABLED &&
    !src.startsWith("http://") &&
    !src.startsWith("https://") &&
    !isImageSource(src)
  ) {
    return src;
  }

  // Everything else keeps its own URL, absolute ones included (the media host
  // too: rewriting it to this site's `/cdn-cgi/image/` would point at a path
  // that does not exist).
  return withSizeQuery(src, width, resolvedQuality);
}
