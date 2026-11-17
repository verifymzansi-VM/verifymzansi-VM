import "server-only";

import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import type { FoundationRefusal } from "./owner-route";
import { hasDatabaseReason } from "./error-reasons";
import {
  ACCOUNT_CLOSURE_SIGN_IN_MINUTES,
  ACCOUNT_CLOSURE_WORD,
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

/** What the database's refusal means for the member; null for anything else. */
function refusalOf(error: { code?: string | null; details?: string | null }) {
  if (error.code === "42501" && hasDatabaseReason(error, "recent_sign_in_required"))
    return new AccountClosureRefusal({
      status: 401,
      error: `For your safety, sign in again, then delete your account within ${ACCOUNT_CLOSURE_SIGN_IN_MINUTES} minutes.`,
      reason: "recent_sign_in_required",
      code: "reauthentication_required",
    });
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
  // Sign-in could not be blocked or a session could not be ended: the whole
  // closure was rolled back (internal.close_account_now).
  if (error.code === "55000")
    return new AccountClosureRefusal({
      status: 503,
      error: "Your account could not be closed. Nothing was changed; try again in a few minutes.",
      reason: "closure_incomplete",
    });
  return null;
}

/**
 * Closes the caller's own account (api.close_my_account). The database decides
 * everything else: the session's own account, a sign-in in the last 15
 * minutes, never a staff account; the posts leave the site, sign-in is
 * blocked, every session ends, slots are cancelled under the Terms, and the
 * account is erased 30 days later. Exactly one call, never retried.
 */
export async function closeMyAccount(api: FoundationAuthenticatedApi, input: unknown) {
  closureRequest.parse(input);
  const { data, error } = await api.rpc("close_my_account", {}, { get: false });
  if (error) throw refusalOf(error) ?? new Error("Account closure unavailable");
  const reply = closureReply.safeParse(data);
  if (!reply.success) throw new Error("Account closure acknowledgement unavailable");
  return {
    status: "closed" as const,
    closedAt: reply.data.closed_at,
    eraseAfter: reply.data.erase_after,
    eraseBy: accountErasureDeadline(new Date(reply.data.erase_after)).toISOString(),
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
