const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** "www.example.co.za", "facebook.com/page", "maps.app.goo.gl/abc" */
const BARE_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+(?::\d+)?(?:[/?#]|$)/i;

/**
 * Normalize URLs typed on mobile keyboards before validation.
 * Users commonly enter values like "https:// www.example.co.za" or just
 * "www.example.co.za"; URL parsers reject the whitespace or missing scheme
 * even though the intended URL is unambiguous.
 */
export function normalizeUserEnteredUrl(value: string): string {
  const compact = value.trim().replace(/\s+/g, "");
  if (compact && !HAS_SCHEME.test(compact) && BARE_DOMAIN.test(compact)) {
    return `https://${compact}`;
  }
  return compact;
}

export function normalizeUserEnteredUrlInput(value: unknown): unknown {
  return typeof value === "string" ? normalizeUserEnteredUrl(value) : value;
}

export function isValidUserEnteredUrl(value: string): boolean {
  try {
    const url = new URL(normalizeUserEnteredUrl(value));
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
