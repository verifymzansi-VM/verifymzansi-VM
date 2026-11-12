import "server-only";

import { z } from "zod";
import { foundationAuthEmail, foundationCaptchaToken } from "./auth-input";
import {
  createFoundationAuthAttempt,
  foundationVerificationCookies,
  type FoundationAuthCookies,
} from "./auth-attempt";
import { createTimeoutFetch } from "../supabase/fetch-with-timeout";
const inputSchema = z.strictObject({
  email: foundationAuthEmail,
  turnstileToken: foundationCaptchaToken,
});
const secretKey = z.string().regex(/^sb_secret_[A-Za-z0-9_-]+$/);
export class FoundationRecoveryRequestError extends Error {
  override name = "FoundationRecoveryRequestError";
  constructor(readonly status: 400 | 429 | 503) {
    super("Password recovery could not be requested");
  }
}

/** The forgot-password request exactly as accepted: an address and a CAPTCHA
 * token that is not a placeholder. Check it before spending any budget. */
export function parseFoundationRecoveryInput(input: unknown) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new FoundationRecoveryRequestError(400);
  return parsed.data;
}

/** Returns whether Auth accepted the request (it then sends the link if the
 * address has an account). An address-specific refusal is hidden: it returns
 * false and the caller still answers as for any address. */
export async function requestFoundationPasswordRecovery(
  connection: unknown,
  input: unknown,
  redirectTo: string,
  cookies: FoundationAuthCookies,
  fetcher: typeof fetch = createTimeoutFetch()
): Promise<boolean> {
  const data = parseFoundationRecoveryInput(input);
  const verification: Parameters<FoundationAuthCookies["setAll"]>[0] = [];
  try {
    const attempt = createFoundationAuthAttempt(
      connection,
      {
        getAll: () => cookies.getAll(),
        setAll: async (items, headers) => {
          verification.push(...foundationVerificationCookies(items));
          await cookies.setAll(items, headers);
        },
      },
      fetcher
    );
    const { error } = await attempt.auth.resetPasswordForEmail(data.email, {
      redirectTo,
      captchaToken: data.turnstileToken,
    });
    if (attempt.cookieAccessFailed()) throw new FoundationRecoveryRequestError(503);
    if (error) {
      if (error.code === "captcha_failed") throw new FoundationRecoveryRequestError(400);
      if (error.status === 429) throw new FoundationRecoveryRequestError(429);
      if (![400, 401, 403, 404, 422].includes(error.status ?? 0))
        throw new FoundationRecoveryRequestError(503);
      // A refusal must not expose address existence by deleting its random slot.
      await cookies.setAll(verification, {});
      return false;
    }
    return true;
  } catch (error) {
    if (error instanceof FoundationRecoveryRequestError) throw error;
    throw new FoundationRecoveryRequestError(503);
  }
}

/** Whether the server's secret key binding (needed for password setup) is set. */
export function hasFoundationPasswordSetupKey(environment: NodeJS.ProcessEnv = process.env) {
  return secretKey.safeParse(environment.FOUNDATION_SUPABASE_SECRET_KEY).success;
}

export class FoundationPasswordSetupEmailError extends Error {
  override name = "FoundationPasswordSetupEmailError";
  constructor(readonly status: 429 | 503) {
    super("The password setup email could not be requested");
  }
}

/**
 * Trusted server step for a signed-in member who has no password (the
 * password setup route checks session, recent sign-in, account and limits
 * first). Asks Auth to send the usual reset link, with a selected PKCE flow as
 * for recovery, to that member's own verified address: never pass an address
 * taken from the request body.
 *
 * The request carries the project's secret key. Auth's CAPTCHA check skips
 * requests with admin credentials (GoTrue verifyCaptcha), so the restored
 * profile page needs no CAPTCHA widget; the route's checks take its place.
 * Only the address's own inbox receives the link.
 */
export async function requestFoundationPasswordSetupEmail(
  connection: unknown,
  email: string,
  redirectTo: string,
  cookies: FoundationAuthCookies,
  environment: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = createTimeoutFetch()
) {
  const key = secretKey.safeParse(environment.FOUNDATION_SUPABASE_SECRET_KEY);
  if (!key.success) throw new FoundationPasswordSetupEmailError(503);
  try {
    const attempt = createFoundationAuthAttempt(connection, cookies, fetcher, key.data);
    const { error } = await attempt.auth.resetPasswordForEmail(email, { redirectTo });
    if (attempt.cookieAccessFailed()) throw new FoundationPasswordSetupEmailError(503);
    if (error) throw new FoundationPasswordSetupEmailError(error.status === 429 ? 429 : 503);
  } catch (error) {
    if (error instanceof FoundationPasswordSetupEmailError) throw error;
    throw new FoundationPasswordSetupEmailError(503);
  }
}
