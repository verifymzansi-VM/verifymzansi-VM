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
export function createFoundationPasswordUpdater(
  input: unknown,
  token: string,
  subject: string,
  fetcher: typeof fetch
) {
  const connection = parseFoundationConnection(input);
  return async (currentPassword: string, newPassword: string): Promise<void> => {
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
        body: JSON.stringify({ password: newPassword, current_password: currentPassword }),
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
