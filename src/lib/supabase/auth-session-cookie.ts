// @supabase/ssr stores the browser session in cookies named
// `sb-<project-ref>-auth-token` (chunked as `-auth-token.0`, `.1`, ... when large).
// The PKCE `-auth-token-code-verifier` cookie is not a session.
const SUPABASE_AUTH_COOKIE_NAME = /^sb-[^=;\s]*-auth-token(\.\d+)?$/;

export const PLAYWRIGHT_SESSION_COOKIE_NAME = "vmz_pw_session";

/**
 * Cheap presence check for a persisted session, shared by the server render
 * and the browser so both pick the same signed-in/out shell. Presence is only
 * a hint: the session itself is still validated with Supabase on the client.
 */
export function hasAuthSessionCookie(cookieNames: Iterable<string>, stubMode: boolean): boolean {
  for (const name of cookieNames) {
    if (stubMode ? name === PLAYWRIGHT_SESSION_COOKIE_NAME : SUPABASE_AUTH_COOKIE_NAME.test(name)) {
      return true;
    }
  }
  return false;
}
