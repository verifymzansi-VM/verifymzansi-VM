import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { FoundationStaffCommandError } from "./staff-command";
import { staffVerifyHref } from "../auth/staff-mfa-links";
import { readFoundationServerSession } from "./server-session";
import { readRestoredGovernance } from "./governance";
export const readRestoredGovernancePage = cache(async (limit = 50, id?: string) => {
  const current = await readFoundationServerSession();
  try {
    return await readRestoredGovernance(current.api, current.user.id, {
      limit,
      ...(id ? { id, status: "all" as const } : {}),
    });
  } catch (error) {
    if (error instanceof FoundationStaffCommandError && error.mfaRequired)
      redirect(
        staffVerifyHref(
          "/staff/two-step?confirm=1",
          id ? `/admin/governance/escalations/${id}` : "/admin/governance/escalations"
        )
      );
    throw error;
  }
});
