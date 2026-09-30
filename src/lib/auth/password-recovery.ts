import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export const PASSWORD_RECOVERY_COOKIE = "vm_password_recovery";
export const PASSWORD_RECOVERY_MAX_AGE_SECONDS = 60 * 60;

function signature(payload: string): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Password recovery signing is unavailable");
  return createHmac("sha256", key).update(`password-recovery:${payload}`).digest("hex");
}

/** Called only after Supabase successfully redeems a recovery token hash. */
export function createRecoveryProof(userId: string, accessToken: string): string | null {
  // The token here comes directly from verifyOtp, not from the caller.
  const claims = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString());
  if (claims.sub !== userId || typeof claims.session_id !== "string" || !claims.session_id) {
    return null;
  }
  const payload = Buffer.from(
    JSON.stringify({
      userId,
      sessionId: claims.session_id,
      issuedAt: Math.floor(Date.now() / 1000),
    })
  ).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

/** Bind the redemption proof to the currently authenticated Supabase session. */
export function verifyRecoveryProof(
  proof: string | undefined,
  userId: string,
  sessionId: unknown,
  now = Math.floor(Date.now() / 1000)
): boolean {
  if (!proof || proof.length > 2048 || typeof sessionId !== "string") return false;
  try {
    const [payload, mac, extra] = proof.split(".");
    if (extra !== undefined || !payload || !mac || !/^[a-f0-9]{64}$/.test(mac)) return false;
    if (!timingSafeEqual(Buffer.from(mac, "hex"), Buffer.from(signature(payload), "hex"))) {
      return false;
    }
    const value = JSON.parse(Buffer.from(payload, "base64url").toString());
    return (
      value.userId === userId &&
      value.sessionId === sessionId &&
      Number.isInteger(value.issuedAt) &&
      value.issuedAt <= now &&
      now - value.issuedAt <= PASSWORD_RECOVERY_MAX_AGE_SECONDS
    );
  } catch {
    return false;
  }
}
