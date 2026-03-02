/**
 * Sanitize a return URL to prevent open redirect attacks.
 * Only allows relative paths starting with "/".
 */
export function sanitizeReturnUrl(url: string | null | undefined): string {
  if (!url) return "/dashboard";

  // Normalize backslashes to forward slashes (some browsers treat \ as /)
  const normalized = url.replace(/\\/g, "/");

  // Must start with "/" and not "//"
  if (!normalized.startsWith("/") || normalized.startsWith("//")) {
    return "/dashboard";
  }

  // Block protocol-relative URLs and data URIs
  const lower = normalized.toLowerCase();
  if (lower.includes("://") || lower.startsWith("javascript:") || lower.startsWith("data:")) {
    return "/dashboard";
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
