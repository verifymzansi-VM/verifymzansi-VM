import { FREE_POST_CONFIG } from "@/lib/constants/pricing";

const DAY_MS = 24 * 60 * 60 * 1000;

export function getLegacyFreePostCutoffIso(now = new Date()): string {
  return new Date(now.getTime() - FREE_POST_CONFIG.durationDays * DAY_MS).toISOString();
}

export function applyVisibleExpiryFilter<T>(query: T, nowIso = new Date().toISOString()): T {
  const maybeQuery = query as T & { or?: (filter: string) => T };
  const now = new Date(nowIso);
  const legacyCutoffIso = getLegacyFreePostCutoffIso(
    Number.isFinite(now.getTime()) ? now : new Date()
  );

  return typeof maybeQuery.or === "function"
    ? maybeQuery.or(
        `expires_at.gt.${nowIso},and(expires_at.is.null,created_at.gt.${legacyCutoffIso})`
      )
    : query;
}

export function isVisibleByExpiry(
  expiresAt: string | null | undefined,
  now = new Date(),
  createdAt?: string | null | undefined
): boolean {
  if (!expiresAt) {
    if (!createdAt) return true;

    const createdTime = new Date(createdAt).getTime();
    return (
      Number.isFinite(createdTime) &&
      now.getTime() - createdTime < FREE_POST_CONFIG.durationDays * DAY_MS
    );
  }

  const expiryTime = new Date(expiresAt).getTime();
  return Number.isFinite(expiryTime) && expiryTime > now.getTime();
}
