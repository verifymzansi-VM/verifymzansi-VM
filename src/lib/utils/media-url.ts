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
  // Already using the proxy route — extract key after prefix
  if (url.startsWith(PROXY_PREFIX)) {
    return url.slice(PROXY_PREFIX.length);
  }

  // Custom-domain media URL
  if (url.startsWith(MEDIA_BASE + "/")) {
    return url.slice(MEDIA_BASE.length + 1);
  }

  // R2 S3-compatible URL
  const r2Match = url.match(/^https?:\/\/[^/]+\.r2\.cloudflarestorage\.com\/(.+)$/);
  if (r2Match) {
    return r2Match[1];
  }

  return null;
}

/**
 * Rewrite a media URL for optimal delivery:
 * - Videos → direct CDN URL (avoids server proxy, enables native Range requests)
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

  // Images: serve through proxy for ETag/cache-control
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
