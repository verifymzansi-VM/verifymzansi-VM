import "server-only";
import { cache } from "react";
import { readFoundationServerSession } from "./server-session";
import { readRestoredGovernance } from "./governance";
export const readRestoredGovernancePage = cache(async (limit = 50, id?: string) => {
  const current = await readFoundationServerSession();
  return readRestoredGovernance(current.api, current.user.id, {
    limit,
    ...(id ? { id, status: "all" as const } : {}),
  });
});
