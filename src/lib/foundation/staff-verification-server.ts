import "server-only";
import { cache } from "react";
import { readFoundationServerSession } from "./server-session";
import { readFrontendStaffVerificationQueue } from "./staff-verification-queue";
export const readRestoredStaffVerificationQueue = cache(async (limit = 100, includeIds = "[]") => {
  const current = await readFoundationServerSession();
  return readFrontendStaffVerificationQueue(
    current.api,
    current.user.id,
    limit,
    JSON.parse(includeIds)
  );
});
