/** Call only after GoTrue has verified this exact JWT. A query parameter,
 * cookie user object or the SDK verifier's mutable redirectType is not proof. */
export function foundationRecoveryClaim(
  sessionId: string,
  amr: unknown,
  now = Math.floor(Date.now() / 1000)
) {
  if (!Array.isArray(amr)) return null;
  let issuedAt: number | null = null;
  for (const raw of amr as unknown[]) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const timestamp = entry.timestamp;
    if (
      entry &&
      typeof entry === "object" &&
      entry.method === "recovery" &&
      typeof timestamp === "number" &&
      Number.isSafeInteger(timestamp) &&
      timestamp > 0 &&
      timestamp <= now + 30 &&
      now - timestamp <= 3600
    )
      issuedAt = Math.max(issuedAt ?? 0, timestamp);
  }
  return issuedAt === null ? null : { sessionId, issuedAt };
}

/** Whether this GoTrue-verified session was opened by a reset link at all, at
 * any age. Such a session sets a password only through the reset page, where
 * the link's binding is checked; GoTrue keeps the method for the session's life. */
export function foundationRecoveryOpened(amr: unknown) {
  return (
    Array.isArray(amr) &&
    amr.some((entry: unknown) => {
      if (!entry || typeof entry !== "object") return false;
      return (entry as Record<string, unknown>).method === "recovery";
    })
  );
}
