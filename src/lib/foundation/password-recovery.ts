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
export class FoundationRecoveryRequestError extends Error {
  constructor(readonly status: 400 | 429 | 503) {
    super("Password recovery could not be requested");
  }
}
export async function requestFoundationPasswordRecovery(
  connection: unknown,
  input: unknown,
  redirectTo: string,
  cookies: FoundationAuthCookies,
  fetcher: typeof fetch = createTimeoutFetch()
) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new FoundationRecoveryRequestError(400);
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
    const { error } = await attempt.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo,
      captchaToken: parsed.data.turnstileToken,
    });
    if (attempt.cookieAccessFailed()) throw new FoundationRecoveryRequestError(503);
    if (error) {
      if (error.code === "captcha_failed") throw new FoundationRecoveryRequestError(400);
      if (error.status === 429) throw new FoundationRecoveryRequestError(429);
      if (![400, 401, 403, 404, 422].includes(error.status ?? 0))
        throw new FoundationRecoveryRequestError(503);
      // A refusal must not expose address existence by deleting its random slot.
      await cookies.setAll(verification, {});
    }
  } catch (error) {
    if (error instanceof FoundationRecoveryRequestError) throw error;
    throw new FoundationRecoveryRequestError(503);
  }
}
