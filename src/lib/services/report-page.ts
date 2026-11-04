import "server-only";
import { getDataBackend } from "@/lib/data-backend";
import { createAdminClient } from "@/lib/supabase/admin";
import { countMyClaims, getClaimsForItems, type ClaimView } from "./queue-claims";
import type { ReportItem } from "../admin/report-item";
import { FoundationStaffCommandError } from "../foundation/staff-command";
import { staffVerifyHref } from "../auth/staff-mfa-links";
import { createLogger } from "../utils/logger";
export async function readReportsPage(actorId: string) {
  if (getDataBackend() === "foundation") {
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
  const admin = createAdminClient();
  const [open, active, closed, myClaims] = await Promise.all([
    admin
      .from("reports")
      .select("*", { count: "exact" })
      .eq("status", "open")
      .order("severity", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(200),
    admin
      .from("reports")
      .select("*")
      .eq("status", "in_progress")
      .order("created_at", { ascending: true })
      .limit(200),
    admin
      .from("reports")
      .select("*")
      .in("status", ["resolved", "dismissed"])
      .order("updated_at", { ascending: false })
      .limit(50),
    countMyClaims(actorId, "reports"),
  ]);
  const error = open.error ?? active.error ?? closed.error;
  if (error)
    createLogger("AdminReportsPage").error("Reports read failed", { error: error.message });
  const openRows: ReportItem[] = open.data ?? [];
  const claims: Record<string, ClaimView> = error
    ? {}
    : await getClaimsForItems(
        actorId,
        openRows.map((r) => ({ type: "report", id: r.id }))
      );
  return {
    reports: [...openRows, ...(active.data ?? []), ...(closed.data ?? [])] as ReportItem[],
    open: openRows,
    openTotal: open.count ?? openRows.length,
    myClaims,
    claims,
    error,
  };
}
