import "server-only";

import { z } from "zod";
import { parseFoundationConnection } from "./connection";
import { authErrorCode } from "./auth-error-code";
import { createLogger } from "../utils/logger";

const log = createLogger("FoundationPasswordUpdate");
const secretKey = z.string().regex(/^sb_secret_[A-Za-z0-9_-]+$/);

export class FoundationPasswordUpdateError extends Error {
  override name = "FoundationPasswordUpdateError";
  constructor(
    readonly status: 400 | 401 | 403 | 429 | 503,
    readonly reason:
      "current_password" | "mfa_required" | "reauthentication" | "password_policy" | "unavailable",
    /** Finer outcome for recovery only: the new password already is the
     * current one ("same_password"), or the update was sent and its outcome
     * is unknown ("uncertain": no reply, a server error or an unreadable reply). */
    readonly detail?: "same_password" | "uncertain"
  ) {
    super("Password update could not be completed");
  }
}

/** A recovery update whose outcome is unknown. Global sign-out was attempted
 * anyway, because the new password may already be in force. */
export class FoundationPasswordResetUncertainError extends FoundationPasswordUpdateError {
  override name = "FoundationPasswordResetUncertainError";
  constructor(readonly signOutComplete: boolean) {
    super(503, "unavailable", "uncertain");
  }
}

/** Construct only after exact-token verification. The closure keeps that same
 * caller for the PUT: no second sign-in, refresh, cookie-user claim or submitted
 * account selector can substitute another account or downgrade its MFA session.
 */
function passwordCommand(input: unknown, token: string, subject: string, fetcher: typeof fetch) {
  const connection = parseFoundationConnection(input);
  return async (currentPassword: string | undefined, newPassword: string): Promise<void> => {
    let response: Response;
    try {
      response = await fetcher(`${connection.url}/auth/v1/user`, {
        method: "PUT",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        headers: {
          apikey: connection.publishableKey,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Supabase-Api-Version": "2024-01-01",
        },
        body: JSON.stringify({
          password: newPassword,
          ...(currentPassword === undefined ? {} : { current_password: currentPassword }),
        }),
      });
    } catch {
      // A timeout or dropped connection may come after the provider applied it.
      throw new FoundationPasswordUpdateError(503, "unavailable", "uncertain");
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      // The request asks for API version 2024-01-01, whose replies carry the
      // code as `code`; older replies used `error_code` (auth-error-code.ts).
      const code = authErrorCode(body);
      if (code === "current_password_invalid" || code === "current_password_required")
        throw new FoundationPasswordUpdateError(400, "current_password");
      if (code === "insufficient_aal") throw new FoundationPasswordUpdateError(403, "mfa_required");
      if (code === "reauthentication_needed")
        throw new FoundationPasswordUpdateError(401, "reauthentication");
      if (code === "same_password")
        throw new FoundationPasswordUpdateError(400, "password_policy", "same_password");
      if (code === "weak_password") throw new FoundationPasswordUpdateError(400, "password_policy");
      throw new FoundationPasswordUpdateError(
        response.status === 401 ? 401 : response.status === 429 ? 429 : 503,
        "unavailable",
        response.status >= 500 ? "uncertain" : undefined
      );
    }
    const user = body && typeof body === "object" && "user" in body ? body.user : body;
    if (!user || typeof user !== "object" || !("id" in user) || user.id !== subject)
      throw new FoundationPasswordUpdateError(503, "unavailable", "uncertain");
  };
}

/** What the password change needs, from the verified session only, to
 * confirm the current password itself. */
export interface FoundationPasswordCheck {
  /** The session's own address as GoTrue returned it, never request input. */
  email: string | undefined;
  /** The account has a verified authenticator that this session has not
   * used (GoTrue `aal1`); Auth then refuses the change (insufficient_aal). */
  authenticatorStepMissing: boolean;
  /** When this session signed in (seconds; sign-in-claims.ts), or null. */
  signedInAt: number | null;
}

/** Auth asks a session older than this to sign in again before a password
 * change when its "secure password change" setting is on (GoTrue UserUpdate:
 * 24 hours after the session began). */
const REAUTHENTICATION_SECONDS = 24 * 3600;

/** True when `accessToken` names a session. Auth signs out EVERY session of
 * a token without one (GoTrue Logout), so only such a token may be used. */
function namesSession(accessToken: string) {
  try {
    const claims: unknown = JSON.parse(
      atob(accessToken.split(".")[1].replaceAll("-", "+").replaceAll("_", "/"))
    );
    return z.object({ session_id: z.uuid() }).safeParse(claims).success;
  } catch {
    return false;
  }
}

/** Ends only the session that the verification sign-in created. */
async function endVerificationSession(
  connection: ReturnType<typeof parseFoundationConnection>,
  accessToken: unknown,
  fetcher: typeof fetch
) {
  if (typeof accessToken !== "string" || !namesSession(accessToken)) return false;
  try {
    const response = await fetcher(`${connection.url}/auth/v1/logout?scope=local`, {
      method: "POST",
      headers: { apikey: connection.publishableKey, Authorization: `Bearer ${accessToken}` },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Confirms the current password with a password sign-in for the session's
 * own address, so a wrong one is refused even when Auth's "Require current
 * password when updating" setting is off. The sign-in carries the project's
 * secret key, which Auth's CAPTCHA check skips (GoTrue verifyCaptcha, as for
 * password setup in password-recovery.ts); the caller's per-account budget
 * takes its place. Its tokens are never stored or returned: the session it
 * created is ended at once (scope local, that session only). Should that
 * fail, a successful change still ends it, as Auth signs every other session
 * out when a password changes (GoTrue UpdatePassword).
 */
async function confirmCurrentPassword(
  connection: ReturnType<typeof parseFoundationConnection>,
  key: string,
  email: string,
  subject: string,
  password: string,
  fetcher: typeof fetch
) {
  let response: Response;
  try {
    response = await fetcher(`${connection.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Supabase-Api-Version": "2024-01-01",
      },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    // Nothing was changed; any session it may have made has no known token.
    throw new FoundationPasswordUpdateError(503, "unavailable");
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    // Auth answers a wrong password, and an account without one, alike.
    const code = authErrorCode(body);
    if (code === "invalid_credentials")
      throw new FoundationPasswordUpdateError(400, "current_password");
    // Auth's own limit on sign-ins is per network address, and every server
    // check comes from the website's address: not the member's attempts.
    log.error("Password check refused", {
      status: response.status,
      code: code && /^[a-z_]{1,64}$/.test(code) ? code : "other",
    });
    throw new FoundationPasswordUpdateError(503, "unavailable");
  }
  const reply = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (!(await endVerificationSession(connection, reply.access_token, fetcher)))
    log.error("Password check session could not be ended");
  const user = reply.user;
  if (!user || typeof user !== "object" || !("id" in user) || user.id !== subject)
    throw new FoundationPasswordUpdateError(503, "unavailable");
}

/**
 * The change-password command (current password known). In order: Auth's
 * authenticator-step and fresh-session rules (GoTrue checks both before any
 * password, so a session refused by either learns nothing about the
 * password; the second is applied whether or not Auth's setting is on), the
 * caller's budget
 * for password checks (`chargeCheck`, which throws when spent), this server's
 * own check of the current password, then the update, which still sends the
 * current password so Auth checks it too when its setting is on.
 */
export function createFoundationPasswordUpdater(
  input: unknown,
  token: string,
  subject: string,
  fetcher: typeof fetch,
  check: FoundationPasswordCheck,
  environment: NodeJS.ProcessEnv = process.env
) {
  const connection = parseFoundationConnection(input);
  const update = passwordCommand(connection, token, subject, fetcher);
  return async (
    currentPassword: string,
    newPassword: string,
    chargeCheck: () => Promise<void>
  ): Promise<void> => {
    if (check.authenticatorStepMissing)
      throw new FoundationPasswordUpdateError(403, "mfa_required");
    const now = Math.floor(Date.now() / 1000);
    if (check.signedInAt === null || now - check.signedInAt > REAUTHENTICATION_SECONDS)
      throw new FoundationPasswordUpdateError(401, "reauthentication");
    const key = secretKey.safeParse(environment.FOUNDATION_SUPABASE_SECRET_KEY);
    if (!key.success || typeof check.email !== "string" || !check.email)
      throw new FoundationPasswordUpdateError(503, "unavailable");
    await chargeCheck();
    await confirmCurrentPassword(
      connection,
      key.data,
      check.email,
      subject,
      currentPassword,
      fetcher
    );
    await update(currentPassword, newPassword);
  };
}

/** Issued only for a GoTrue-verified signed recovery method. Logout failure is
 * reported separately after a committed update; callers must not repeat the PUT.
 *
 * - The provider refusing the new password as the current one ("same_password")
 *   means it is already in force: an earlier attempt whose outcome was unknown
 *   committed it, or the member typed the password they have. Either way the
 *   reset is complete, so sessions are signed out and it reports success
 *   (`alreadyCurrent`). This is no password oracle: any other guess would
 *   replace the password, and only a holder of this verified recovery session
 *   (and, in the route, its binding) gets this far.
 * - An update with an unknown outcome still signs every session out (best
 *   effort), since the new password may be in force, then fails as uncertain.
 */
export function createFoundationPasswordResetter(
  input: unknown,
  token: string,
  subject: string,
  issuedAt: number,
  fetcher: typeof fetch
) {
  const connection = parseFoundationConnection(input);
  const update = passwordCommand(connection, token, subject, fetcher);
  const signOutEverywhere = async () => {
    try {
      const response = await fetcher(`${connection.url}/auth/v1/logout?scope=global`, {
        method: "POST",
        headers: { apikey: connection.publishableKey, Authorization: `Bearer ${token}` },
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
      });
      await response.body?.cancel();
      return response.ok;
    } catch {
      return false;
    }
  };
  return async (password: string) => {
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(issuedAt) || issuedAt > now + 30 || now - issuedAt > 3600)
      throw new FoundationPasswordUpdateError(401, "reauthentication");
    try {
      await update(undefined, password);
    } catch (error) {
      if (!(error instanceof FoundationPasswordUpdateError)) throw error;
      if (error.detail === "same_password")
        return { signOutComplete: await signOutEverywhere(), alreadyCurrent: true };
      if (error.detail === "uncertain")
        throw new FoundationPasswordResetUncertainError(await signOutEverywhere());
      throw error;
    }
    return { signOutComplete: await signOutEverywhere(), alreadyCurrent: false };
  };
}
