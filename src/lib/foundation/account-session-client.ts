import { FoundationAccountContextError, parseFoundationAccountContext } from "./account-context";
import { createTimeoutFetch } from "../supabase/fetch-with-timeout";

/** Same-origin account view, without exposing a session token in JSON or
 * falling back to the legacy profile table. No client-side shared cache.
 */
export async function fetchFoundationAccountSession(fetcher: typeof fetch = createTimeoutFetch()) {
  try {
    const response = await fetcher("/api/foundation/auth/session", {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (response.status === 401) return null;
    if (response.status === 403) throw new FoundationAccountContextError("forbidden");
    if (!response.ok) throw new FoundationAccountContextError("unavailable");
    return parseFoundationAccountContext(await response.json());
  } catch (error) {
    if (error instanceof FoundationAccountContextError) throw error;
    throw new FoundationAccountContextError("unavailable");
  }
}
