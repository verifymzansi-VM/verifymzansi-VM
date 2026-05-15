const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function getExpiryCountdownLabel(
  expiresAt: string | null | undefined,
  nowMs = Date.now()
): string | null {
  if (!expiresAt) return null;

  const expiryMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiryMs)) return null;

  const diffMs = expiryMs - nowMs;
  if (diffMs <= 0) return "Expired";

  if (diffMs < HOUR_MS) {
    const minutes = Math.max(1, Math.ceil(diffMs / MINUTE_MS));
    return `Expires in ${minutes}m`;
  }

  if (diffMs < 48 * HOUR_MS) {
    const hours = Math.max(1, Math.ceil(diffMs / HOUR_MS));
    return `Expires in ${hours}h`;
  }

  const days = Math.max(1, Math.ceil(diffMs / DAY_MS));
  return `Expires in ${days}d`;
}
