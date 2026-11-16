import { type NextRequest } from "next/server";
import { handleRestoredReportAction } from "@/lib/foundation/restored-report-action-route";

/**
 * POST /api/admin/flagging/action
 *
 * Act on a report. The database applies the policy in one transaction
 * (moderate_report): any staff member may dismiss or warn; governors and
 * admins may hide the reported item; suspensions and bans are proposals that
 * another governor or admin approves, except emergency containment (a
 * 72-hour suspension by a governor or admin, reviewed by someone else).
 * Nobody acts on a report they filed or one about their own account.
 */
export async function POST(request: Request) {
  return handleRestoredReportAction(request as NextRequest);
}
