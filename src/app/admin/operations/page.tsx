import Link from "next/link";
import { requireStaff } from "@/lib/auth/require-staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/utils/logger";
import { formatDateTime } from "@/lib/utils/format";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RetryJobButton } from "./retry-job-button";

export const metadata = {
  title: "Operations health — Admin",
  description: "Failed decision updates, stuck jobs and incidents that need a person.",
};

/** The expiry job runs every 5 minutes; flag it if it has been quiet for 15. */
const EXPIRY_STALE_MS = 15 * 60 * 1000;

/** Server-rendered per request, so reading the clock here is deterministic for the response. */
function isStale(lastRunAt: string | null | undefined): boolean {
  return !lastRunAt || Date.now() - new Date(lastRunAt).getTime() > EXPIRY_STALE_MS;
}

export default async function OperationsHealthPage() {
  const { role } = await requireStaff("audit:view");
  const admin = createAdminClient();

  const [deadJobs, failedDecisions, events, heartbeat, backlog] = await Promise.all([
    admin
      .from("operation_jobs")
      .select("id, kind, attempts, last_error, decision_id, updated_at", { count: "exact" })
      .eq("status", "dead")
      .order("updated_at", { ascending: false })
      .limit(50),
    admin
      .from("decision_records")
      .select("id, action_category, execution_error, decided_at", { count: "exact" })
      .eq("execution_status", "failed")
      .order("decided_at", { ascending: false })
      .limit(50),
    admin
      .from("ops_events")
      .select("id, kind, severity, detail, created_at")
      .is("acknowledged_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
    admin
      .from("ops_heartbeats")
      .select("last_run_at, detail")
      .eq("name", "expire_due_items")
      .maybeSingle(),
    admin
      .from("operation_jobs")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "running"]),
  ]);

  const failed = [deadJobs, failedDecisions, events].find((r) => r.error);
  if (failed?.error) {
    createLogger("OperationsHealth").error("Operations health read failed", {
      error: failed.error.message,
    });
    return (
      <p role="alert">
        Operations health could not be loaded. Refresh to try again. This does not mean everything
        is working.
      </p>
    );
  }

  const expiryStale = isStale(heartbeat.data?.last_run_at);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations health"
        description="Work that was approved but did not finish, and incidents that need a person."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Operations health" }]}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Stuck jobs</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">{deadJobs.count ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Failed decision updates</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">{failedDecisions.count ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Jobs waiting</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">{backlog.count ?? "Unavailable"}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Expiry job</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <Badge variant={expiryStale ? "destructive" : "outline"}>
              {expiryStale ? "Not running" : "Running"}
            </Badge>
            <p className="text-xs text-muted-foreground">
              {heartbeat.data?.last_run_at
                ? `Last run ${formatDateTime(heartbeat.data.last_run_at)}`
                : "No run recorded"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Failed decision updates</CardTitle>
        </CardHeader>
        <CardContent>
          {!failedDecisions.data?.length ? (
            <p className="text-sm text-muted-foreground">
              None. Every approved decision was applied.
            </p>
          ) : (
            <ul className="space-y-2">
              {failedDecisions.data.map((d) => (
                <li key={d.id} className="rounded-lg border p-3 text-sm">
                  <Link
                    href={`/admin/governance/escalations/${d.id}`}
                    className="font-medium underline"
                  >
                    {d.action_category.replace(/_/g, " ")}
                  </Link>
                  <p className="text-xs text-muted-foreground">{d.execution_error}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stuck jobs</CardTitle>
        </CardHeader>
        <CardContent>
          {!deadJobs.data?.length ? (
            <p className="text-sm text-muted-foreground">None. Notices and syncs are going out.</p>
          ) : (
            <ul className="space-y-2">
              {deadJobs.data.map((job) => (
                <li
                  key={job.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{job.kind.replace(/_/g, " ")}</p>
                    <p className="text-xs text-muted-foreground">
                      {job.attempts} attempts · last {formatDateTime(job.updated_at)}
                    </p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{job.last_error}</p>
                  </div>
                  {role === "admin" && <RetryJobButton jobId={job.id} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Open incidents</CardTitle>
        </CardHeader>
        <CardContent>
          {!events.data?.length ? (
            <p className="text-sm text-muted-foreground">No open incidents.</p>
          ) : (
            <ul className="space-y-2">
              {events.data.map((e) => (
                <li key={e.id} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">
                    {e.kind.replace(/_/g, " ")}{" "}
                    <Badge variant={e.severity === "critical" ? "destructive" : "outline"}>
                      {e.severity}
                    </Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(e.created_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
