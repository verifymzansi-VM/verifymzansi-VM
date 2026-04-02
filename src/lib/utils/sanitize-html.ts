/**
 * Strip all HTML from user-supplied text by escaping dangerous characters.
 *
 * Unlike a naive `/<[^>]*>/g` regex strip, this escapes HTML entities so
 * entity-encoded payloads (`&#60;script&#62;`) and attribute-injection
 * vectors (`onload="alert(1)"`) are rendered inert when the stored value
 * is later displayed — regardless of rendering context.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * Sanitize a user-supplied message for safe storage.
 *
 * 1. Strips all HTML tags (defence-in-depth).
 * 2. Escapes remaining HTML entities.
 * 3. Trims leading/trailing whitespace.
 */
export function sanitizeUserMessage(input: string): string {
  const stripped = input.replace(/<[^>]*>/g, "");
  return escapeHtml(stripped).trim();
}

/**
 * Return a safe href for user-supplied external URLs.
 *
 * Only allows `http:` and `https:` protocols.  Any other scheme
 * (e.g. `javascript:`, `data:`, `vbscript:`) is replaced with `"#"`,
 * preventing XSS via `<a href={userInput}>`.
 */
export function safeExternalHref(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return url;
    }
    return "#";
  } catch {
    // Relative paths or garbage — disallow
    return "#";
  }
}
