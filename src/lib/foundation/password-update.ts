import "server-only";

import { parseFoundationConnection } from "./connection";

export class FoundationPasswordUpdateError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 429 | 503,
    readonly reason:
      "current_password" | "mfa_required" | "reauthentication" | "password_policy" | "unavailable"
  ) {
    super("Password update could not be completed");
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
      throw new FoundationPasswordUpdateError(503, "unavailable");
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
      if (code === "weak_password" || code === "same_password")
        throw new FoundationPasswordUpdateError(400, "password_policy");
      throw new FoundationPasswordUpdateError(
        response.status === 401 ? 401 : response.status === 429 ? 429 : 503,
        "unavailable"
      );
    }
    const user = body && typeof body === "object" && "user" in body ? body.user : body;
    if (!user || typeof user !== "object" || !("id" in user) || user.id !== subject)
      throw new FoundationPasswordUpdateError(503, "unavailable");
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
  return async (password: string) => {
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(issuedAt) || issuedAt > now + 30 || now - issuedAt > 3600)
      throw new FoundationPasswordUpdateError(401, "reauthentication");
    await update(undefined, password);
    try {
      const response = await fetcher(`${connection.url}/auth/v1/logout?scope=global`, {
        method: "POST",
        headers: { apikey: connection.publishableKey, Authorization: `Bearer ${token}` },
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
      });
      await response.body?.cancel();
      return { signOutComplete: response.ok };
    } catch {
      return { signOutComplete: false };
    }
  };
}
