import "server-only";

import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import type { FoundationRefusal } from "./owner-route";
import { hasDatabaseReason } from "./error-reasons";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import {
  ACCOUNT_CLOSURE_SIGN_IN_MINUTES,
  ACCOUNT_CLOSURE_WORD,
  ACCOUNT_CLOSURE_UNKNOWN_OUTCOME,
  accountErasureDeadline,
  confirmsAccountClosure,
} from "@/lib/account/account-closure";

/** A refusal of api.close_my_account the member can act on. */
class AccountClosureRefusal extends Error {
  override name = "AccountClosureRefusal";
  constructor(readonly refusal: FoundationRefusal) {
    super(refusal.reason);
  }
}

const closureRequest = z.strictObject({
  confirmation: z.string().max(64).refine(confirmsAccountClosure),
});

const timestamp = z
  .string()
  .max(64)
  .refine((value) => !Number.isNaN(Date.parse(value)));

const closureReply = z.object({
  status: z.literal("closed"),
  closed_at: timestamp,
  erase_after: timestamp,
  request_id: z.uuid(),
});

const recentSignInRequired = () =>
  new AccountClosureRefusal({
    status: 401,
    error: `For your safety, sign in again, then delete your account within ${ACCOUNT_CLOSURE_SIGN_IN_MINUTES} minutes.`,
    reason: "recent_sign_in_required",
    code: "reauthentication_required",
  });

/** The request was sent and its outcome is unknown: the account may be closed. */
const outcomeUnknown = () =>
  new AccountClosureRefusal({
    status: 503,
    error: ACCOUNT_CLOSURE_UNKNOWN_OUTCOME,
    reason: "outcome_unknown",
    code: "outcome_unknown",
  });

/** A code the database (SQLSTATE) or PostgREST (PGRST…) gave: the request was
 * answered, so its transaction did not commit. Anything else (no reply, a
 * gateway error) leaves the outcome unknown. */
const ANSWERED_CODE = /^(?:[0-9A-Z]{5}|PGRST\d{3})$/;

/** What the database's refusal means for the member. */
function refusalOf(error: { code?: string | null; details?: string | null }) {
  if (error.code === "42501" && hasDatabaseReason(error, "recent_sign_in_required"))
    return recentSignInRequired();
  if (error.code === "42501" && hasDatabaseReason(error, "staff_account"))
    return new AccountClosureRefusal({
      status: 409,
      error:
        "A staff account can't be deleted while it has a staff role. Ask another administrator to end your staff roles first.",
      reason: "staff_account",
    });
  // No live session, or the address is not confirmed (internal.account_closing_actor).
  if (error.code === "42501")
    return new AccountClosureRefusal({
      status: 401,
      error: "Sign in again to delete your account.",
      reason: "session_required",
    });
  if (error.code === "PT404" && hasDatabaseReason(error, "account_unavailable"))
    return new AccountClosureRefusal({
      status: 404,
      error: "This account no longer exists.",
      reason: "account_unavailable",
    });
  if (typeof error.code !== "string" || !ANSWERED_CODE.test(error.code)) return outcomeUnknown();
  // Any other answered error rolled the whole closure back, including sign-in
  // that could not be blocked or a session that could not be ended (55000,
  // internal.close_account_now).
  return new AccountClosureRefusal({
    status: 503,
    error: "Your account could not be closed. Nothing was changed; try again in a few minutes.",
    reason: "closure_failed",
  });
}

/** The verified caller (owner-route.ts): `signedInAt` comes only from a
 * password or Google sign-in in this session (foundationLatestSignIn). */
type Caller = { accountId: string; signedInAt?: number | null };

/**
 * Closes the caller's own account (api.close_my_account). Before the call:
 * the typed word, a per-account limit, and a password or Google sign-in in
 * the last 15 minutes. The database's own check also accepts a session opened
 * by an emailed link (reset, magic link, invite) or an authenticator step, so
 * this route refuses those first. The database decides the rest: the
 * session's own account, never a staff account; the posts leave the site,
 * sign-in is blocked, every session ends, and the account is erased 30 days
 * later. Exactly one call, never retried.
 */
export async function closeMyAccount(
  api: FoundationAuthenticatedApi,
  input: unknown,
  caller: Caller | undefined,
  now = Date.now()
) {
  closureRequest.parse(input);
  if (!caller) throw new Error("Verified caller required");
  const limit = await checkRateLimit({
    key: caller.accountId,
    action: "account:delete",
    degradedMode: "block",
  });
  if (limit.degraded || limit.limited)
    throw new AccountClosureRefusal(
      limit.degraded
        ? { status: 503, error: "Protection is temporarily unavailable", reason: "limiter" }
        : {
            status: 429,
            error: "Too many requests; try again shortly",
            reason: "rate_limited",
            code: "rate_limited",
            retryAfter: limit.retryAfter ?? 60,
          }
    );
  const signedInAt = caller.signedInAt ?? null;
  if (signedInAt === null || now / 1000 - signedInAt > ACCOUNT_CLOSURE_SIGN_IN_MINUTES * 60)
    throw recentSignInRequired();

  let reply: { data: unknown; error: { code?: string | null; details?: string | null } | null };
  try {
    reply = await api.rpc("close_my_account", {}, { get: false });
  } catch {
    throw outcomeUnknown();
  }
  if (reply.error) throw refusalOf(reply.error);
  const closed = closureReply.safeParse(reply.data);
  // Answered without an error, so it committed; but the dates are unreadable.
  if (!closed.success) throw outcomeUnknown();
  return {
    status: "closed" as const,
    closedAt: closed.data.closed_at,
    eraseAfter: closed.data.erase_after,
    eraseBy: accountErasureDeadline(new Date(closed.data.erase_after)).toISOString(),
  };
}

/** The route's refusal for an error thrown by closeMyAccount, or null. */
export function accountClosureRefusal(error: unknown): FoundationRefusal | null {
  if (error instanceof AccountClosureRefusal) return error.refusal;
  if (error instanceof z.ZodError)
    return {
      status: 422,
      error: `Type ${ACCOUNT_CLOSURE_WORD} to confirm.`,
      reason: "confirmation_required",
    };
  return null;
}
