import "server-only";

import type { CookieMethodsServer } from "@supabase/ssr";
import { z } from "zod";
import { parseFoundationConnection } from "./connection";
import { createTimeoutFetch } from "../supabase/fetch-with-timeout";
import { createFoundationAuthAttempt } from "./auth-attempt";
import { foundationAuthEmail, foundationCaptchaToken } from "./auth-input";

const credentialsSchema = z.strictObject({
  email: foundationAuthEmail,
  // Signing in must not apply the rules for choosing a new password.
  password: z.string().min(1).max(128),
  turnstileToken: foundationCaptchaToken,
});

export class FoundationPasswordAuthError extends Error {
  constructor(readonly status: 400 | 401 | 429 | 503) {
    super(
      status === 400
        ? "Check the sign-in details and complete the CAPTCHA"
        : status === 401
          ? "Unable to sign in with these details"
          : status === 429
            ? "Too many attempts; try again shortly"
            : "Sign-in is temporarily unavailable"
    );
  }
}

/** Password sign-in only: no profile writes, role grants or secondary sign-in.
 * GoTrue consumes the CAPTCHA exactly once; callers MUST NOT first submit it
 * to Siteverify. Enable the route only after native CAPTCHA is configured on
 * the approved target. This adapter does not attest that provider setting.
 * Cookie writes must be staged by the caller and committed only on success.
 */
export async function signInFoundationPassword(
  input: unknown,
  credentials: unknown,
  cookies: Required<Pick<CookieMethodsServer, "getAll" | "setAll">>,
  fetcher: typeof fetch = createTimeoutFetch()
): Promise<void> {
  const config = parseFoundationConnection(input);
  const parsed = credentialsSchema.safeParse(credentials);
  if (!parsed.success) throw new FoundationPasswordAuthError(400);
  if (typeof cookies?.getAll !== "function" || typeof cookies?.setAll !== "function")
    throw new FoundationPasswordAuthError(503);

  try {
    const attempt = createFoundationAuthAttempt(config, cookies, fetcher);
    const { email, password, turnstileToken } = parsed.data;
    const { data, error } = await attempt.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken: turnstileToken },
    });
    if (attempt.cookieAccessFailed()) throw new FoundationPasswordAuthError(503);
    if (error)
      throw new FoundationPasswordAuthError(
        error.status === 429 ? 429 : [400, 401, 403, 422].includes(error.status ?? 0) ? 401 : 503
      );
    if (
      !data.session ||
      !z.uuid().safeParse(data.user?.id).success ||
      data.user?.is_anonymous ||
      !data.user?.email_confirmed_at
    )
      throw new FoundationPasswordAuthError(503);
    // Never return tokens, provider diagnostics or user_metadata to the route.
    // Subsequent protected commands still verify the session through GoTrue
    // and enforce the live account/session/MFA checks in the database.
  } catch (error) {
    if (error instanceof FoundationPasswordAuthError) throw error;
    throw new FoundationPasswordAuthError(503);
  }
}
