export const PLAYWRIGHT_SESSION_PREFIX = "persona:";
/** Decode only the identity hint; the server fixture separately checks the exact session token. */
export function decodePlaywrightPersona(token: string | null | undefined): string | null {
  if (!token) return null;
  try {
    const normalized = decodeURIComponent(token);
    if (!normalized.startsWith(PLAYWRIGHT_SESSION_PREFIX)) return null;
    return decodeURIComponent(
      normalized.slice(PLAYWRIGHT_SESSION_PREFIX.length).replace(/:[0-9a-f-]{36}$/i, "")
    );
  } catch {
    return null;
  }
}
