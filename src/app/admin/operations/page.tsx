import Link from "next/link";
import { requireStaff } from "@/lib/auth/require-staff";
import { redirect } from "next/navigation";
import { SHOW_STAFF_OPERATIONS } from "@/lib/hidden-features";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import {
  readStaffOperationsHealth,
  type OperationsHealth,
  type ScheduledJob,
} from "@/lib/foundation/operations-health";
import { FoundationStaffCommandError } from "@/lib/foundation/staff-command";
import { staffVerifyHref } from "@/lib/auth/staff-mfa-links";
import { createLogger } from "@/lib/utils/logger";
import { formatDateTime } from "@/lib/utils/format";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Operations health — Admin",
  description: "Stuck emails and notices, payment problems, blocked deletions and late jobs.",
};

const PATH = "/admin/operations";

const JOB_LABELS: Record<ScheduledJob, string> = {
  slot_renewals: "Slot renewals",
  post_lifecycle: "Post expiry and deletion",
  sponsorships: "Sponsored places",
  inbox_purge: "Old enquiries and notices removed",
  intro_trials: "Free trial checks",
  commissions: "Partner commissions",
  bank_transfer_expiry: "Bank transfer expiry",
  package_add_invoices: "Unpaid added-slot invoices",
  email_delivery: "Emails",
  payment_alerts: "Payment alerts to staff",
  privacy_notices: "Privacy request notices",
  retention: "Data retention",
  form_drafts: "Saved form drafts removed",
  evidence_cleanup: "ID evidence files deleted",
  media_cleanup: "Photo and video files deleted",
  payment_checks: "Payment status checks",
  refund_check: "Daily refund check",
};

const SCHEDULES: Record<OperationsHealth["jobs"][number]["every"], string> = {
  minute: "Every minute",
  "5_minutes": "Every 5 minutes",
  "10_minutes": "Every 10 minutes",
  day: "Daily",
};

/** "amount_mismatch" -> "amount mismatch". */
function words(code: string): string {
  return code.replace(/_/g, " ");
}

export default async function OperationsHealthPage() {
  await requireStaff("audit:view");
  // Hidden until launch (src/lib/hidden-features.ts).
  if (!SHOW_STAFF_OPERATIONS) redirect("/admin");

  let health: OperationsHealth;
  try {
    const { api } = await readFoundationServerSession();
    health = await readStaffOperationsHealth(api);
  } catch (error) {
    if (error instanceof FoundationStaffCommandError && error.mfaRequired)
      redirect(staffVerifyHref("/staff/two-step", PATH));
    createLogger("OperationsHealth").error("Operations health read failed");
    return (
      <p role="alert">
        Operations health could not be loaded. Refresh to try again. This does not mean everything
        is working.
      </p>
    );
  }

  const { emails, notices, payments, deletions, incidents } = health;
  const tiles = [
    { label: "Stuck emails", value: emails.stuck },
    { label: "Stuck notices", value: notices.stuck },
    { label: "Payment problems", value: payments.problems },
    { label: "Blocked deletions", value: deletions.accounts_blocked },
  ];
  const retentionTiles = [
    { label: "Evidence past its purge date", value: deletions.evidence_overdue, alert: true },
    { label: "File deletions stuck over a day", value: deletions.files_stuck, alert: true },
    { label: "File deletions queued", value: deletions.files_queued, alert: false },
    { label: "Accounts on legal hold", value: deletions.legal_holds, alert: false },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations health"
        description="Work that did not finish, scheduled jobs that stopped, and incidents that need a person."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Operations health" }]}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <Card key={tile.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{tile.label}</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold">{tile.value}</CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Scheduled jobs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Scheduled job</th>
                  <th className="py-2 pr-4 font-medium">Last run</th>
                  <th className="py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {health.jobs.map((job) => (
                  <tr key={job.job} className="border-t">
                    <td className="py-2 pr-4">
                      {JOB_LABELS[job.job]}
                      <span className="block text-xs text-muted-foreground">
                        {SCHEDULES[job.every]}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-xs">
                      {job.last_run_at ? formatDateTime(job.last_run_at) : "Never"}
                    </td>
                    <td className="py-2">
                      <Badge variant={job.late ? "destructive" : "outline"}>
                        {job.late ? "Late" : "On time"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stuck emails</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Not sent after the last of 8 tries, or still not sent a day after they were queued.{" "}
            {emails.waiting} {emails.waiting === 1 ? "email is" : "emails are"} waiting to send.
          </p>
          {!emails.items.length ? (
            <p className="text-sm text-muted-foreground">None. Emails are going out.</p>
          ) : (
            <ul className="space-y-2">
              {emails.items.map((email, index) => (
                <li key={index} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">{words(email.kind)}</p>
                  <p className="text-xs text-muted-foreground">
                    {email.attempts} attempts · queued {formatDateTime(email.queued_at)}
                  </p>
                  {email.last_error && (
                    <p className="text-xs text-muted-foreground">{words(email.last_error)}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stuck notices</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Privacy request notices not sent after the last of 8 tries, or still not sent a day
            after they were queued.
          </p>
          {!notices.items.length ? (
            <p className="text-sm text-muted-foreground">None. Notices are going out.</p>
          ) : (
            <ul className="space-y-2">
              {notices.items.map((notice, index) => (
                <li key={index} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">{words(notice.kind)} notice</p>
                  <p className="text-xs text-muted-foreground">
                    {notice.attempts} attempts · queued {formatDateTime(notice.queued_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment problems</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Seen in the past 7 days. Work on them from{" "}
            <Link href="/admin/payments" className="font-medium underline">
              Payments &amp; Refunds
            </Link>
            .
          </p>
          {payments.not_activated > 0 && (
            <p className="text-sm font-medium text-destructive">
              {payments.not_activated} paid{" "}
              {payments.not_activated === 1 ? "payment was" : "payments were"} not activated.
            </p>
          )}
          {!payments.items.length ? (
            <p className="text-sm text-muted-foreground">None in the past 7 days.</p>
          ) : (
            <ul className="space-y-2">
              {payments.items.map((problem, index) => (
                <li
                  key={index}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{words(problem.reason)}</p>
                    <p className="text-xs text-muted-foreground">
                      {problem.payment_ref ? `Payment ${problem.payment_ref} · ` : ""}
                      {words(problem.source)} · seen {problem.occurrences}{" "}
                      {problem.occurrences === 1 ? "time" : "times"} · last{" "}
                      {formatDateTime(problem.last_seen_at)}
                    </p>
                  </div>
                  {problem.alerted && <Badge variant="outline">Staff alerted</Badge>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Blocked deletions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Closed accounts whose deletion is held back, and why.
          </p>
          {!deletions.items.length ? (
            <p className="text-sm text-muted-foreground">
              None. Closed accounts are being deleted on time.
            </p>
          ) : (
            <ul className="space-y-2">
              {deletions.items.map((deletion, index) => (
                <li key={index} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">{words(deletion.reason)}</p>
                  <p className="text-xs text-muted-foreground">
                    Closed by {deletion.closed_by} · held back since{" "}
                    {formatDateTime(deletion.blocked_at)} · due{" "}
                    {formatDateTime(deletion.erase_after)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Evidence retention</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Identity evidence is deleted 30 days after review, or 90 days when the check failed or
            was appealed. Accounts on legal hold keep their evidence until the hold is lifted.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {retentionTiles.map((tile) => (
              <div key={tile.label} className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{tile.label}</p>
                <p
                  className={`text-xl font-bold ${tile.alert && tile.value > 0 ? "text-destructive" : ""}`}
                >
                  {tile.value}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Open incidents</CardTitle>
        </CardHeader>
        <CardContent>
          {!incidents.items.length ? (
            <p className="text-sm text-muted-foreground">No open incidents.</p>
          ) : (
            <ul className="space-y-2">
              {incidents.items.map((alarm, index) => (
                <li key={index} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">
                    {words(alarm.metric)} ({alarm.period}){" "}
                    <Badge variant={alarm.level === "critical" ? "destructive" : "outline"}>
                      {alarm.level}
                    </Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(alarm.raised_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
