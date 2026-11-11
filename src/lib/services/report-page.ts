import "server-only";
import type { ClaimView } from "./queue-claims";
import type { ReportItem } from "../admin/report-item";
import { FoundationStaffCommandError } from "../foundation/staff-command";
import { staffVerifyHref } from "../auth/staff-mfa-links";
import { createLogger } from "../utils/logger";
export async function readReportsPage(actorId: string) {
  try {
    const { readFoundationServerSession } = await import("../foundation/server-session");
    const { readFrontendReportQueue } = await import("../foundation/report-queue");
    const current = await readFoundationServerSession();
    if (current.user.id !== actorId) throw new Error("Report queue account changed");
    return { ...(await readFrontendReportQueue(current.api, actorId)), error: null };
  } catch (error) {
    if (error instanceof FoundationStaffCommandError && error.mfaRequired) {
      const { redirect } = await import("next/navigation");
      redirect(staffVerifyHref("/staff/two-step?confirm=1", "/admin/reports"));
    }
    createLogger("AdminReportsPage").error("Native report queue unavailable");
    return {
      reports: [] as ReportItem[],
      open: [] as ReportItem[],
      openTotal: 0,
      myClaims: 0,
      claims: {} as Record<string, ClaimView>,
      error: { message: "Reports unavailable" },
    };
  }
}
