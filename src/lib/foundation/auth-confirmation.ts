import "server-only";

import { z } from "zod";
import { createFoundationAuthAttempt, type FoundationAuthCookies } from "./auth-attempt";
import { parseFoundationConnection } from "./connection";
import { createFoundationRequestCaller, FoundationSessionError } from "./request-api";
import { createTimeoutFetch } from "../supabase/fetch-with-timeout";
import { readFoundationAccountProfile } from "./account-profile";

const exchange = z.strictObject({
  code: z
    .string()
    .min(1)
    .max(2048)
    .refine((value) => !/[\u0000-\u0020\u007f]/.test(value)),
  flowId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});

class FoundationConfirmationError extends Error {
  constructor(readonly status: 401 | 503) {
    super("The confirmation could not be completed");
  }
}

/** Exchange only the requested PKCE flow, then verify the resulting caller
 * through GoTrue. No legacy profile creation or cookie-metadata authority.
 * The caller updates its cookie jar on every staged write so the verified
 * session bridge sees the newly exchanged session, never the incoming one.
 * Recovery requires a signed provider AMR and a live owner profile; a mutable
 * redirect type, query marker or cookie user object cannot authorize it.
 */
export async function confirmFoundationAccount(
  connection: unknown,
  input: unknown,
  cookies: FoundationAuthCookies,
  fetcher: typeof fetch = createTimeoutFetch(),
  purpose: "signup" | "recovery" = "signup"
): Promise<void> {
  const parsed = exchange.safeParse(input);
  if (!parsed.success) throw new FoundationConfirmationError(401);
  try {
    const config = parseFoundationConnection(connection);
    const attempt = createFoundationAuthAttempt(config, cookies, fetcher);
    const { data, error } = await attempt.auth.exchangeCodeForSession(parsed.data.code, {
      flowId: parsed.data.flowId,
    });
    if (attempt.cookieAccessFailed()) throw new FoundationConfirmationError(503);
    if (error)
      throw new FoundationConfirmationError(
        [400, 401, 403, 422].includes(error.status ?? 0) ? 401 : 503
      );
    if (
      !data.session ||
      !data.user?.email_confirmed_at ||
      data.user.is_anonymous ||
      (purpose === "signup" && "redirectType" in data && data.redirectType === "recovery")
    )
      throw new FoundationConfirmationError(401);
    const caller = await createFoundationRequestCaller(config, cookies, fetcher);
    if (caller.accountId !== data.user.id) throw new FoundationConfirmationError(401);
    if (purpose === "recovery") {
      if (!caller.recovery) throw new FoundationConfirmationError(401);
      await readFoundationAccountProfile(caller.api);
    }
  } catch (error) {
    if (error instanceof FoundationConfirmationError) throw error;
    if (error instanceof FoundationSessionError)
      throw new FoundationConfirmationError(error.status);
    throw new FoundationConfirmationError(503);
  }
}
