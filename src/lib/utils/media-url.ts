/**
 * Normalize media URLs stored in the database.
 *
 * Uploaded media may be stored with:
 *   1. An R2 S3-compatible URL (requires auth, not publicly accessible)
 *   2. A custom-domain URL like https://media.verifymzansi.com/…
 *
 * Delivery strategy:
 *   - Videos are served DIRECTLY from the R2 public custom domain
 *     (media.verifymzansi.com) — edge-cached by Cloudflare with native HTTP
 *     Range support and zero Worker hop. Videos have no responsive variants,
 *     so the proxy added latency without adding value.
 *   - Images stay on the local media-proxy route (/api/media/serve/…) which
 *     provides responsive WebP variants (…w400/w800/w1600) with fallback to
 *     the original object for legacy uploads, plus SVG hardening.
 */

const MEDIA_BASE = process.env.NEXT_PUBLIC_MEDIA_URL || "https://media.verifymzansi.com";

const PROXY_PREFIX = "/api/media/serve/";
const KNOWN_MEDIA_HOSTS = new Set(["media.verifymzansi.com", "media-staging.verifymzansi.com"]);

const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "ogg", "mov"]);

/**
 * In Playwright stub mode media is served from local fixture files via the
 * proxy route, so keep videos on the proxy there — the real CDN has no test
 * fixtures and e2e runs must never depend on production network access.
 */
function isPlaywrightStubMode(): boolean {
  return (
    (process.env.PLAYWRIGHT_TEST_MODE === "1" ||
      process.env.NEXT_PUBLIC_PLAYWRIGHT_TEST_MODE === "1") &&
    (process.env.PLAYWRIGHT_SUPABASE_MODE === "stub" ||
      process.env.NEXT_PUBLIC_PLAYWRIGHT_SUPABASE_MODE === "stub")
  );
}

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
 * Rewrite a media URL for delivery:
 * - Videos → direct R2 custom-domain URL (edge-cached, native Range support,
 *   no Worker hop). Falls back to the proxy in Playwright stub mode.
 * - Images → media proxy for responsive variants, ETag/304 caching, and
 *   legacy fallback to the original object.
 *
 * Returns the original string unchanged if it doesn't match any known pattern.
 */
export function normalizeMediaUrl(url: string | null | undefined): string {
  if (!url) return "";

  const key = extractMediaStorageKey(url);

  // Not a recognized media URL — return as-is
  if (key === null) return url;

  if (isVideoUrl(key) && !isPlaywrightStubMode()) {
    return `${MEDIA_BASE}/${key}`;
  }

  return `${PROXY_PREFIX}${key}`;
}

/**
 * Normalize a media URL specifically for video playback.
 * Serves directly from the R2 custom domain (edge-cached, native HTTP Range
 * support) unless running in Playwright stub mode, where the proxy serves
 * local fixture files instead.
 */
export function normalizeVideoUrl(url: string | null | undefined): string {
  if (!url) return "";

  const key = extractMediaStorageKey(url);
  if (key === null) return url;

  if (isPlaywrightStubMode()) {
    return `${PROXY_PREFIX}${key}`;
  }

  return `${MEDIA_BASE}/${key}`;
}

/**
 * Normalize an array of media URLs.
 */
export function normalizeMediaUrls(urls: string[]): string[] {
  return urls.map(normalizeMediaUrl);
}

// ── Responsive variant helpers ───────────────────────────────

export type ImageVariant = "thumb" | "card" | "full" | "original";

/** R2 image sizes generated at upload time. */
const VARIANT_WIDTHS: Record<Exclude<ImageVariant, "original">, number> = {
  thumb: 400,
  card: 800,
  full: 1600,
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
 * Build a URL for a pre-generated R2 WebP variant. The media serve route
 * falls back to the original for older or smaller images without that size.
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

  if (/\.w\d+\.webp$/.test(key)) return normalizeMediaUrl(url);
  const dot = key.lastIndexOf(".");
  if (dot <= 0) return normalizeMediaUrl(url);
  return `${PROXY_PREFIX}${key.slice(0, dot)}.w${VARIANT_WIDTHS[variant]}.webp`;
}

/**
 * Return all available variant URLs for responsive image usage.
 */
export function getResponsiveImageUrls(url: string): Record<ImageVariant, string> {
  return {
    thumb: getVariantUrl(url, "thumb"),
    card: getVariantUrl(url, "card"),
    full: getVariantUrl(url, "full"),
    original: normalizeMediaUrl(url),
  };
}
