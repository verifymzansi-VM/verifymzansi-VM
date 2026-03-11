const PLACEHOLDER_PATTERNS = [
  /\[(seed|demo|sample|placeholder)\]/i,
  /\b(seed|demo|sample|placeholder|sandbox)\b/i,
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
