/**
 * Suburb, city and province for display, each name once: a town that shares
 * its city's name ("Richards Bay, Richards Bay") reads as a mistake.
 */
export function placeLine(parts: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  return parts
    .map((part) => (part ?? "").trim())
    .filter((part) => {
      const key = part.toLowerCase();
      if (!part || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(", ");
}
