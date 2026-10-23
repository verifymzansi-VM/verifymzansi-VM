import "server-only";

import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import { z } from "zod";
import { parseFoundationConnection } from "./connection";
import { createTimeoutFetch } from "../supabase/fetch-with-timeout";

const credentialsSchema = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  // Signing in must not apply the rules for choosing a new password.
  password: z.string().min(1).max(128),
  turnstileToken: z
    .string()
    .min(1)
    .max(2048)
    .refine((value) => value.trim() === value && value !== "turnstile-unavailable"),
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

  let cookieAccessFailed = false;
  // Match the SDK's project-specific session name, including local Auth.
  const cookieName = `sb-${new URL(config.url).hostname.split(".")[0]}-auth-token`;
  const client = createServerClient(config.url, config.publishableKey, {
    cookieOptions: { name: cookieName, secure: config.url.startsWith("https://") },
    cookies: {
      async getAll() {
        try {
          // INITIAL_SESSION subscribers may otherwise refresh an expired old
          // account concurrently with this password sign-in. Keep its cookie
          // names for obsolete-chunk cleanup, while withholding session values.
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
          // Let the SDK subscriber settle, then fail closed below.
          cookieAccessFailed = true;
        }
      },
    },
    global: {
      fetch: (request, init) =>
        fetcher(request, { ...init, credentials: "omit", cache: "no-store", redirect: "error" }),
    },
  });
  try {
    const { email, password, turnstileToken } = parsed.data;
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken: turnstileToken },
    });
    if (cookieAccessFailed) throw new FoundationPasswordAuthError(503);
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
