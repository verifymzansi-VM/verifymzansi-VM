/**
 * Normalize URLs typed on mobile keyboards before validation.
 * Users commonly enter values like "https:// www.example.co.za"; URL parsers
 * reject the whitespace even though the intended URL is unambiguous.
 */
export function normalizeUserEnteredUrl(value: string): string {
  return value.trim().replace(/\s+/g, "");
}

export function normalizeUserEnteredUrlInput(value: unknown): unknown {
  return typeof value === "string" ? normalizeUserEnteredUrl(value) : value;
}

export function isValidUserEnteredUrl(value: string): boolean {
  try {
    new URL(normalizeUserEnteredUrl(value));
    return true;
  } catch {
    return false;
  }
}
