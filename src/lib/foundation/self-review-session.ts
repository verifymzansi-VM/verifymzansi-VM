import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { readFoundationRequestCaller } from "./request-api";
import { readFoundationRuntimeConnection } from "./runtime-connection";
import { readMyRestrictionStatus } from "./enforcement";

/** Restricted-account status only. All normal page and command guards still
 * require the active account context. */
export const readSelfReviewCaller = cache(async () => {
  const store = await cookies();
  return readFoundationRequestCaller(readFoundationRuntimeConnection(), {
    getAll: () => store.getAll(),
  });
});
export const readSelfReviewSession = cache(async () => {
  const { api, accountId } = await readSelfReviewCaller();
  return readMyRestrictionStatus(api, accountId);
});
