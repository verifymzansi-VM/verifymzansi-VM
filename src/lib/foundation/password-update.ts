import "server-only";

import { parseFoundationConnection } from "./connection";

export class FoundationPasswordUpdateError extends Error {
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
      const code =
        body && typeof body === "object" && "error_code" in body ? body.error_code : null;
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

export function createFoundationPasswordUpdater(
  input: unknown,
  token: string,
  subject: string,
  fetcher: typeof fetch
) {
  const update = passwordCommand(input, token, subject, fetcher);
  return (currentPassword: string, newPassword: string) => update(currentPassword, newPassword);
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
