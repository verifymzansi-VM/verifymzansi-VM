import "server-only";

import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import { parseFoundationConnection } from "./connection";

export type FoundationAuthCookies = Required<Pick<CookieMethodsServer, "getAll" | "setAll">>;

export function foundationVerificationCookies(
  items: Parameters<FoundationAuthCookies["setAll"]>[0]
) {
  return items.filter(
    (item) =>
      /-code-verifier(?:\.\d+)?$/.test(item.name) &&
      item.options.maxAge !== 0 &&
      Boolean(item.value)
  );
}

/** A fresh Auth operation. Existing sessions cannot start INITIAL_SESSION
 * refreshes here; their names remain available for stale cookie chunk cleanup.
 * This is distinct from the verified-session bridge used by protected commands.
 * Callers stage cookie writes and commit only the operation's accepted result.
 */
export function createFoundationAuthAttempt(
  input: unknown,
  cookies: FoundationAuthCookies,
  fetcher: typeof fetch
) {
  const config = parseFoundationConnection(input);
  if (typeof cookies?.getAll !== "function" || typeof cookies?.setAll !== "function")
    throw new Error("A complete request cookie adapter is required");
  let cookieAccessFailed = false;
  const cookieName = `sb-${new URL(config.url).hostname.split(".")[0]}-auth-token`;
  const client = createServerClient(config.url, config.publishableKey, {
    cookieOptions: { name: cookieName, secure: config.url.startsWith("https://") },
    // The callback requires an explicit slot selector, so one confirmation
    // cannot borrow a different pending flow's verifier. Versions are pinned.
    auth: { experimental: { appendPkceFlowIdToRedirects: true } },
    cookies: {
      async getAll() {
        try {
          return ((await cookies.getAll()) ?? []).map((item) =>
            item.name === cookieName || item.name.startsWith(`${cookieName}.`)
              ? { ...item, value: "" }
              : item
          );
        } catch {
          cookieAccessFailed = true;
          return [];
        }
      },
      async setAll(items, headers) {
        try {
          await cookies.setAll(items, headers);
        } catch {
          // Let the SDK subscriber settle before the operation fails closed.
          cookieAccessFailed = true;
        }
      },
    },
    global: {
      fetch: (request, init) =>
        fetcher(request, { ...init, credentials: "omit", cache: "no-store", redirect: "error" }),
    },
  });
  return Object.freeze({ auth: client.auth, cookieAccessFailed: () => cookieAccessFailed });
}
