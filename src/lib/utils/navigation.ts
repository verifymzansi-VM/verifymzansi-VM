const ALLOWED_REDIRECT_PREFIXES = [
  "/dashboard",
  "/verification",
  "/post",
  "/billing",
  "/admin",
  "/login",
  "/register",
  "/mzansi-market",
  "/mall-shops",
  "/business-ads",
  "/tourism-events",
  "/dsar",
  "/banned",
];

/**
 * Sanitize a return URL to prevent open redirect attacks.
 * Only allows relative paths starting with "/" that match known route prefixes.
 */
export function sanitizeReturnUrl(url: string | null | undefined): string {
  if (!url) return "/";

  // Normalize backslashes to forward slashes (some browsers treat \ as /)
  const normalized = url.replace(/\\/g, "/");

  // Must start with "/" and not "//"
  if (!normalized.startsWith("/") || normalized.startsWith("//")) {
    return "/";
  }

  // Block protocol-relative URLs and data URIs
  const lower = normalized.toLowerCase();
  if (lower.includes("://") || lower.startsWith("javascript:") || lower.startsWith("data:")) {
    return "/";
  }

  // Allow exact "/" (home page)
  if (normalized === "/") return normalized;

  // Only allow known route prefixes to prevent redirect to attacker-controlled paths
  const matchesAllowed = ALLOWED_REDIRECT_PREFIXES.some(
    (prefix) =>
      normalized === prefix ||
      normalized.startsWith(prefix + "/") ||
      normalized.startsWith(prefix + "?")
  );
  if (!matchesAllowed) {
    return "/";
  }

  return normalized;
}

/**
 * Build a login redirect URL preserving the return path.
 */
export function buildLoginUrl(returnUrl?: string): string {
  if (!returnUrl) return "/login";
  const sanitized = sanitizeReturnUrl(returnUrl);
  return `/login?returnUrl=${encodeURIComponent(sanitized)}`;
}
