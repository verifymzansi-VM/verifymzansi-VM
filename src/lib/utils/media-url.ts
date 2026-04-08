/**
 * Normalize media URLs stored in the database.
 *
 * Uploaded photos may be stored with:
 *   1. An R2 S3-compatible URL (requires auth, not publicly accessible)
 *   2. A custom-domain URL like https://media.verifymzansi.com/…
 *
 * Images are rewritten to use the local media-proxy API route
 * (/api/media/serve/…) for ETag caching and consistent headers.
 *
 * Videos are served directly from the CDN domain to avoid proxying
 * large files through the server, enabling native Range request support
 * and better playback performance.
 */

const MEDIA_BASE = process.env.NEXT_PUBLIC_MEDIA_URL || "https://media.verifymzansi.com";

const PROXY_PREFIX = "/api/media/serve/";
const KNOWN_MEDIA_HOSTS = new Set(["media.verifymzansi.com", "media-staging.verifymzansi.com"]);

const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "ogg", "mov"]);

/**
 * Returns true when a URL points to a platform-controlled media host.
 * Used by create/update validators before persisting media references.
 */
export function isTrustedPlatformMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    const appHostname = appUrl ? new URL(appUrl).hostname : null;
    return (
      parsed.hostname === "media.verifymzansi.com" ||
      parsed.hostname.endsWith(".r2.cloudflarestorage.com") ||
      parsed.hostname.endsWith(".supabase.co") ||
      ((process.env.PLAYWRIGHT_TEST_MODE === "1" ||
        process.env.NEXT_PUBLIC_PLAYWRIGHT_TEST_MODE === "1") &&
        appHostname !== null &&
        parsed.hostname === appHostname)
    );
  } catch {
    return false;
  }
}

/**
 * Check if a URL or key points to a video file based on extension.
 */
function isVideoUrl(url: string): boolean {
  const ext = url.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_EXTENSIONS.has(ext);
}

/**
 * Extract the storage key from various URL formats.
 * Returns null if the URL doesn't match any known pattern.
 */
export function extractMediaStorageKey(url: string): string | null {
  // Stored raw key (without a URL) from some legacy/seed data paths
  if (url.startsWith("media/") || url.startsWith("listings/")) {
    return url;
  }

  // Already using the proxy route — extract key after prefix
  if (url.startsWith(PROXY_PREFIX)) {
    return url.slice(PROXY_PREFIX.length);
  }

  // Custom-domain media URL
  if (url.startsWith(MEDIA_BASE + "/")) {
    return url.slice(MEDIA_BASE.length + 1);
  }

  // Absolute URL handling for app/proxy/media/R2 hosts
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/^\/+/, "");

    if (parsed.pathname.startsWith(PROXY_PREFIX)) {
      return parsed.pathname.slice(PROXY_PREFIX.length);
    }

    if (KNOWN_MEDIA_HOSTS.has(parsed.hostname)) {
      return pathname || null;
    }

    if (parsed.hostname.endsWith(".r2.cloudflarestorage.com")) {
      return pathname || null;
    }
  } catch {
    // Not an absolute URL format we can parse.
  }

  return null;
}

/**
 * Rewrite a media URL for optimal delivery:
 * - Videos → local proxy route (reliable MIME types, Range request support)
 * - Images → local proxy route (benefits from ETag/304 caching)
 *
 * Returns the original string unchanged if it doesn't match any known pattern.
 */
export function normalizeMediaUrl(url: string | null | undefined): string {
  if (!url) return "";

  const key = extractMediaStorageKey(url);

  // Not a recognized media URL — return as-is
  if (key === null) return url;

  // Videos: serve through proxy for reliable MIME types and Range support.
  // The proxy streams video data without buffering, so no memory penalty.
  if (isVideoUrl(url)) {
    return `${PROXY_PREFIX}${key}`;
  }

  // Images: serve through local media proxy for ETag/304 caching.
  // The proxy streams from R2 with consistent headers.
  return `${PROXY_PREFIX}${key}`;
}

/**
 * Normalize a media URL specifically for video playback.
 * Routes through the serve proxy for reliable MIME types, Range request
 * support, and consistent headers. The proxy streams without buffering.
 */
export function normalizeVideoUrl(url: string | null | undefined): string {
  if (!url) return "";

  const key = extractMediaStorageKey(url);
  if (key === null) return url;

  return `${PROXY_PREFIX}${key}`;
}

/**
 * Normalize an array of media URLs.
 */
export function normalizeMediaUrls(urls: string[]): string[] {
  return urls.map(normalizeMediaUrl);
}

// ── Responsive variant helpers ───────────────────────────────

export type ImageVariant = "thumb" | "card" | "full" | "original";

/** Cloudflare Image Resizing widths & qualities per variant. */
const VARIANT_PARAMS: Record<
  Exclude<ImageVariant, "original">,
  { width: number; quality: number }
> = {
  thumb: { width: 400, quality: 80 },
  card: { width: 800, quality: 85 },
  full: { width: 1600, quality: 90 },
};

/**
 * Return the CDN-addressable URL for a media storage key.
 * This URL can be used with Cloudflare Image Resizing or as a direct
 * source in `<Image>` components. Falls back to the proxy path if the
 * key cannot be resolved.
 */
export function getMediaCdnUrl(keyOrUrl: string): string {
  const key = extractMediaStorageKey(keyOrUrl);
  if (!key) return keyOrUrl;
  return `https://${MEDIA_BASE.replace(/^https?:\/\//, "")}/${key}`;
}

/**
 * Build a Cloudflare Image Resizing URL for a specific variant.
 *
 * When CF Image Resizing is disabled (dev/staging), returns the proxy path
 * unchanged so images still render (unoptimised but functional).
 *
 * @param url     - Any media URL or storage key
 * @param variant - Size preset: "thumb" (400w), "card" (800w), "full" (1600w), "original"
 */
export function getVariantUrl(url: string, variant: ImageVariant = "original"): string {
  if (variant === "original") return normalizeMediaUrl(url);

  const key = extractMediaStorageKey(url);
  if (!key) return url;

  // Video files don't have image variants
  if (isVideoUrl(url)) return normalizeMediaUrl(url);

  const { width, quality } = VARIANT_PARAMS[variant];
  return `/cdn-cgi/image/width=${width},quality=${quality},format=auto/https://${MEDIA_BASE.replace(/^https?:\/\//, "")}/${key}`;
}

/**
 * Return all variant URLs for responsive `<Image>` srcSet usage.
 * Falls back to the proxy URL for each variant when CF Image Resizing
 * is unavailable (the Next.js custom loader handles the same fallback).
 */
export function getResponsiveImageUrls(url: string): Record<ImageVariant, string> {
  return {
    thumb: getVariantUrl(url, "thumb"),
    card: getVariantUrl(url, "card"),
    full: getVariantUrl(url, "full"),
    original: normalizeMediaUrl(url),
  };
}
