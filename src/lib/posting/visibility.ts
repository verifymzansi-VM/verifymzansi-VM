export function applyVisibleExpiryFilter<T>(query: T, nowIso = new Date().toISOString()): T {
  const maybeQuery = query as T & { or?: (filter: string) => T };
  return typeof maybeQuery.or === "function"
    ? maybeQuery.or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    : query;
}

export function isVisibleByExpiry(expiresAt: string | null | undefined, now = new Date()): boolean {
  if (!expiresAt) return true;

  const expiryTime = new Date(expiresAt).getTime();
  return Number.isFinite(expiryTime) && expiryTime > now.getTime();
}
