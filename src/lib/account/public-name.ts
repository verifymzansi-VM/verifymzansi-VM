/**
 * How a person's name appears publicly: first name and surname initial
 * ("Thando D."). After ID verification the account name is the legal name, so
 * the full name stays with staff (POPIA); pages, feeds, APIs and structured
 * data use this instead.
 */
export function publicPersonName(name: string | null | undefined): string | null {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  const initial = Array.from(parts[parts.length - 1])[0]?.toLocaleUpperCase("en-ZA");
  return initial ? `${parts[0]} ${initial}.` : parts[0];
}

/** A copy of an account profile row with its display name made public-safe. */
export function withPublicName<T extends { display_name?: string | null }>(row: T): T;
export function withPublicName<T extends { display_name?: string | null }>(row: T | null): T | null;
export function withPublicName<T extends { display_name?: string | null }>(
  row: T | null
): T | null {
  return row ? { ...row, display_name: publicPersonName(row.display_name) } : row;
}
