import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { readFoundationRequestCaller, FoundationSessionError } from "./request-api";
import { readFoundationAccountContext, FoundationAccountContextError } from "./account-context";
import { readFoundationRuntimeConnection } from "./runtime-connection";

export class FoundationServerSessionError extends Error {
  constructor(readonly status: 401 | 403 | 503) {
    super("A verified account page session is required");
  }
}

/** Protected Server Components only. The page proxy owns refresh/cookie writes
 * and private response headers. React cache shares this only within a render
 * request; no module singleton stores another request's identity or privileges.
 */
export const readFoundationServerSession = cache(async () => {
  try {
    const store = await cookies();
    const caller = await readFoundationRequestCaller(readFoundationRuntimeConnection(), {
      getAll: () => store.getAll(),
    });
    const account = await readFoundationAccountContext(caller.api);
    if (account.account_id !== caller.accountId || caller.user.id !== caller.accountId)
      throw new FoundationServerSessionError(503);
    return { account, user: caller.user, api: caller.api };
  } catch (error) {
    if (error instanceof FoundationServerSessionError) throw error;
    if (error instanceof FoundationSessionError)
      throw new FoundationServerSessionError(error.status);
    if (error instanceof FoundationAccountContextError && error.reason === "forbidden")
      throw new FoundationServerSessionError(403);
    throw new FoundationServerSessionError(503);
  }
});
