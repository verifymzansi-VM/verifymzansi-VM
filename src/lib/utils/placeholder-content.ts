/**
 * Seed and test posts are hidden from public lists and showrooms. Only clear
 * test markers count: a bracketed tag ("[demo] …") or the words "placeholder"
 * / "sandbox". Plain words like "seed", "demo" or "sample" are ordinary
 * selling language ("seed potatoes", "free samples", "book a demo") and must
 * never hide a real post.
 */
const PLACEHOLDER_PATTERNS = [
  /\[(seed|demo|sample|placeholder|sandbox|test)\]/i,
  /\b(placeholder|sandbox)\b/i,
];

function matchesPlaceholderPattern(value: string | null | undefined): boolean {
  if (!value) return false;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

export function isPlaceholderMarketplaceContent(
  ...fields: Array<string | null | undefined>
): boolean {
  return fields.some((field) => matchesPlaceholderPattern(field));
}
