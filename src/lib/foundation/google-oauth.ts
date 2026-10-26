import "server-only";

import { createFoundationAuthAttempt, type FoundationAuthCookies } from "./auth-attempt";
import { parseFoundationConnection } from "./connection";
import { createTimeoutFetch } from "../supabase/fetch-with-timeout";

/** Native provider authentication uses the target project's PKCE cookies.
 * Check provider availability before issuing an unusable redirect. No source
 * project session, profile writes, or provider credentials are involved.
 */
export async function beginFoundationGoogleOAuth(
  connection: unknown,
  redirectTo: string,
  cookies: FoundationAuthCookies,
  fetcher: typeof fetch = createTimeoutFetch()
) {
  const config = parseFoundationConnection(connection);
  const settings = await fetcher(`${config.url}/auth/v1/settings`, {
    headers: { apikey: config.publishableKey },
    cache: "no-store",
    redirect: "error",
  });
  if (!settings.ok || (await settings.json())?.external?.google !== true)
    throw new Error("Google authentication is unavailable");
  const attempt = createFoundationAuthAttempt(config, cookies, fetcher);
  const { data, error } = await attempt.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: "select_account" } },
  });
  if (attempt.cookieAccessFailed() || error || !data.url) throw new Error("OAuth could not start");
  const url = new URL(data.url);
  if (
    url.origin !== config.url ||
    url.pathname !== "/auth/v1/authorize" ||
    url.searchParams.get("provider") !== "google" ||
    url.searchParams.get("code_challenge_method") !== "s256"
  )
    throw new Error("OAuth returned an invalid redirect");
  return { url: url.toString() };
}
