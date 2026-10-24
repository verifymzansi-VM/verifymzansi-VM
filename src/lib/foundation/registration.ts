import "server-only";

import { z } from "zod";
import { foundationAuthEmail, foundationCaptchaToken } from "./auth-input";
import { createFoundationAuthAttempt, type FoundationAuthCookies } from "./auth-attempt";
import { normalizePersonName, isPersonName, isReservedPersonName } from "./person-name";
import { isPwnedPassword, PWNED_PASSWORD_ERROR } from "../security/pwned-passwords";
import { createTimeoutFetch } from "../supabase/fetch-with-timeout";
import { parseFoundationConnection } from "./connection";

const registration = z
  .strictObject({
    email: foundationAuthEmail,
    displayName: z
      .string()
      .max(400)
      .transform(normalizePersonName)
      .refine(isPersonName)
      .refine((value) => !isReservedPersonName(value)),
    password: z.string().min(12).max(128),
    confirmPassword: z.string().max(128),
    acceptTerms: z.literal(true),
    turnstileToken: foundationCaptchaToken,
  })
  .refine((value) => value.password === value.confirmPassword);

export class FoundationRegistrationError extends Error {
  constructor(
    readonly status: 400 | 429 | 503,
    breached = false
  ) {
    super(
      breached
        ? PWNED_PASSWORD_ERROR
        : status === 400
          ? "Check the registration details and complete the CAPTCHA"
          : status === 429
            ? "Too many attempts; try again shortly"
            : "Registration is temporarily unavailable"
    );
  }
}

/** The target's auth.users trigger creates its private profile. Display name
 * is an unverified claim, never authority. The authenticated posting-terms
 * command separately records acceptance of each posting-terms version.
 */
export async function registerFoundationAccount(
  connection: unknown,
  input: unknown,
  redirectTo: string,
  cookies: FoundationAuthCookies,
  fetcher: typeof fetch = createTimeoutFetch()
): Promise<void> {
  const parsed = registration.safeParse(input);
  if (!parsed.success) throw new FoundationRegistrationError(400);
  try {
    const config = parseFoundationConnection(connection);
    let breached: boolean;
    try {
      breached = await isPwnedPassword(parsed.data.password);
    } catch {
      throw new FoundationRegistrationError(503);
    }
    if (breached) throw new FoundationRegistrationError(400, true);
    const verifierWrites: Parameters<FoundationAuthCookies["setAll"]>[0] = [];
    const attempt = createFoundationAuthAttempt(
      config,
      {
        getAll: () => cookies.getAll(),
        setAll: async (items, headers) => {
          for (const item of items)
            if (
              /-code-verifier(?:\.\d+)?$/.test(item.name) &&
              item.options.maxAge !== 0 &&
              item.value
            )
              verifierWrites.push(item);
          await cookies.setAll(items, headers);
        },
      },
      fetcher
    );
    const { email, password, displayName, turnstileToken } = parsed.data;
    const { data, error } = await attempt.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
        emailRedirectTo: redirectTo,
        captchaToken: turnstileToken,
      },
    });
    if (attempt.cookieAccessFailed()) throw new FoundationRegistrationError(503);
    if (error) {
      if (error.code === "user_already_exists" || error.code === "email_exists") {
        // The SDK removes this attempt's verifier on an explicit refusal.
        // Restore only its random PKCE state so cookie deletion cannot reveal
        // that the address exists while the response body promises anonymity.
        await cookies.setAll(verifierWrites, {});
        return;
      }
      throw new FoundationRegistrationError(
        error.status === 429
          ? 429
          : error.code === "signup_disabled" || ![400, 401, 403, 422].includes(error.status ?? 0)
            ? 503
            : 400
      );
    }
    // Confirmed-email signup is mandatory. Discard an unexpected auto-login.
    if (data.session || !z.uuid().safeParse(data.user?.id).success)
      throw new FoundationRegistrationError(503);
  } catch (error) {
    if (error instanceof FoundationRegistrationError) throw error;
    throw new FoundationRegistrationError(503);
  }
}
