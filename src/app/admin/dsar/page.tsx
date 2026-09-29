import { requireStaff } from "@/lib/auth/require-staff";
import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelativeTime, formatSaShortDate } from "@/lib/utils/format";
import { maskEmail } from "@/lib/utils/mask";
import { FileText, Plus } from "lucide-react";
import { DsarActionButtons } from "./dsar-action-buttons";
import { DsarCaseControls } from "./dsar-case-controls";
import { createLogger } from "@/lib/utils/logger";
import type { DsarCase } from "@/types/database";
import type { DsarStatus } from "@/types/enums";

export const metadata = {
  title: "Data requests — Admin",
  description: "Process POPIA data requests before their deadlines.",
};

const OPEN_STATUSES: DsarStatus[] = ["submitted", "identity_pending", "in_progress"];
const CLOSED_STATUSES: DsarStatus[] = ["completed", "rejected"];
const PAGE_SIZE = 25;
const DUE_SOON_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const VIEWS = ["open", "due_soon", "overdue", "mine", "closed"] as const;
type DsarView = (typeof VIEWS)[number];
const VIEW_LABELS: Record<DsarView, string> = {
  open: "All open",
  due_soon: `Due in ${DUE_SOON_DAYS} days`,
  overdue: "Overdue",
  mine: "Assigned to me",
  closed: "Closed",
};

interface DeadlineRule {
  request_type: string;
  extension_days: number;
  statutory: boolean;
}

/** Server-rendered per request, so reading the clock here is deterministic for the response. */
function requestTime(): number {
  return Date.now();
}

function daysUntil(iso: string, now: number): number {
  return Math.ceil((new Date(iso).getTime() - now) / DAY_MS);
}

export default async function AdminDSARPage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string; page?: string }>;
}) {
  const { user } = await requireStaff("dsar:manage");

  const params = (await searchParams) ?? {};
  const view: DsarView = VIEWS.includes(params.view as DsarView)
    ? (params.view as DsarView)
    : "open";
  const parsedPage = Number(params.page || 1);
  const page =
    Number.isSafeInteger(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 100_000) : 1;

  const now = requestTime();
  const nowIso = new Date(now).toISOString();
  const dueSoonIso = new Date(now + DUE_SOON_DAYS * DAY_MS).toISOString();
  const admin = createAdminClient();

  // Open views are ordered by the deadline that applies now (after any
  // extension), most urgent first; closed cases newest first. Every case
  // stays reachable through paging.
  let query = admin
    .from("dsar_cases")
    .select("*", { count: "exact" })
    .in("status", view === "closed" ? CLOSED_STATUSES : OPEN_STATUSES);
  if (view === "overdue") query = query.lt("effective_due_at", nowIso);
  if (view === "due_soon")
    query = query.gte("effective_due_at", nowIso).lt("effective_due_at", dueSoonIso);
  if (view === "mine") query = query.eq("assigned_to", user.id);
  query =
    view === "closed"
      ? query.order("created_at", { ascending: false })
      : query.order("effective_due_at", { ascending: true });

  const [casesResult, overdueResult, dueSoonResult, rulesResult] = await Promise.all([
    query.order("id", { ascending: true }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    admin
      .from("dsar_cases")
      .select("id", { count: "exact", head: true })
      .in("status", OPEN_STATUSES)
      .lt("effective_due_at", nowIso),
    admin
      .from("dsar_cases")
      .select("id", { count: "exact", head: true })
      .in("status", OPEN_STATUSES)
      .gte("effective_due_at", nowIso)
      .lt("effective_due_at", dueSoonIso),
    admin.from("dsar_deadline_rules").select("request_type, extension_days, statutory"),
  ]);

  const failure =
    casesResult.error ?? overdueResult.error ?? dueSoonResult.error ?? rulesResult.error;
  if (failure) {
    createLogger("AdminDSAR").error("DSAR read failed", { error: failure.message });
    return (
      <p role="alert">
        Data requests could not be loaded. Refresh to try again. This does not mean there are no
        requests.
      </p>
    );
  }

  const requests = (casesResult.data ?? []) as DsarCase[];
  const total = casesResult.count ?? requests.length;
  const rules = new Map(
    ((rulesResult.data ?? []) as DeadlineRule[]).map((r) => [r.request_type, r] as const)
  );

  const assigneeIds = [
    ...new Set(requests.map((r) => r.assigned_to).filter((id): id is string => !!id)),
  ];
  const { data: assignees } = assigneeIds.length
    ? await admin
        .from("account_profiles")
        .select("user_id, display_name")
        .in("user_id", assigneeIds)
    : { data: [] as Array<{ user_id: string; display_name: string | null }> };
  const assigneeNames = new Map(
    (assignees ?? []).map((a) => [a.user_id, a.display_name || "a staff member"] as const)
  );

  const tabCounts: Partial<Record<DsarView, number | null>> = {
    overdue: overdueResult.count,
    due_soon: dueSoonResult.count,
  };
  const hrefFor = (nextView: DsarView, nextPage = 1) =>
    `/admin/dsar?view=${nextView}${nextPage > 1 ? `&page=${nextPage}` : ""}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data requests"
        description="POPIA data requests, most urgent deadline first."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Data requests" }]}
      >
        <Button asChild size="sm" className="gap-2">
          <Link href="/admin/dsar/new">
            <Plus className="h-4 w-4" />
            Record a request
          </Link>
        </Button>
      </PageHeader>

      <nav aria-label="Data request views" className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <Button key={v} asChild size="sm" variant={v === view ? "default" : "outline"}>
            <Link href={hrefFor(v)} aria-current={v === view ? "page" : undefined}>
              {VIEW_LABELS[v]}
              {typeof tabCounts[v] === "number" && tabCounts[v]! > 0 && (
                <Badge
                  variant={v === "overdue" ? "destructive" : "secondary"}
                  className="ml-2 text-[10px]"
                >
                  {tabCounts[v]}
                </Badge>
              )}
            </Link>
          </Button>
        ))}
      </nav>

      <p className="text-sm text-muted-foreground">
        {total} {total === 1 ? "request" : "requests"}
        {total > PAGE_SIZE && ` · Page ${page} of ${Math.ceil(total / PAGE_SIZE)}`}
      </p>

      {!requests.length ? (
        <div className="text-center py-6 text-muted-foreground">
          <FileText className="h-8 w-8 mx-auto mb-3" />
          <p>No data requests in this view.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => {
            const isOpen = OPEN_STATUSES.includes(req.status);
            const due = req.effective_due_at ?? req.extended_due_at ?? req.due_by;
            const days = daysUntil(due, now);
            const rule = rules.get(req.type);
            const canExtend = !!rule && rule.extension_days > 0 && !req.extended_due_at && days > 0;
            return (
              <Card key={req.id}>
                <CardContent className="py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs">
                          DSAR-{req.id.slice(0, 8).toUpperCase()}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {req.type}
                        </Badge>
                        <Badge
                          variant={
                            req.status === "submitted"
                              ? "destructive"
                              : req.status === "completed"
                                ? "default"
                                : "secondary"
                          }
                          className="text-[10px]"
                        >
                          {req.status.replace("_", " ")}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {req.identity_verified
                            ? "identity verified"
                            : req.identity_check === "manual"
                              ? "manual intake: identity not checked"
                              : "identity not checked"}
                        </Badge>
                      </div>
                      <p className="text-sm">{maskEmail(req.requester_email)}</p>
                      {req.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-line">
                          {req.description}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Received {formatRelativeTime(req.received_at ?? req.created_at)}
                        {isOpen && (
                          <>
                            {" · "}
                            <span
                              className={
                                days <= 0
                                  ? "font-semibold text-destructive"
                                  : days <= DUE_SOON_DAYS
                                    ? "font-semibold"
                                    : undefined
                              }
                            >
                              {days <= 0 ? "Overdue since" : "Due"} {formatSaShortDate(due)}
                              {days > 0 && ` (${days} ${days === 1 ? "day" : "days"})`}
                            </span>
                            {req.extended_due_at && " · extended"}
                          </>
                        )}
                        {isOpen &&
                          ` · ${req.assigned_to ? `Assigned to ${req.assigned_to === user.id ? "you" : (assigneeNames.get(req.assigned_to) ?? "a staff member")}` : "Unassigned"}`}
                      </p>
                      {req.legal_basis && (
                        <p className="text-[11px] text-muted-foreground">
                          Deadline basis: {req.legal_basis}
                          {rule && !rule.statutory && " (internal target)"}
                        </p>
                      )}
                      {req.extension_reason && (
                        <p className="text-[11px] text-muted-foreground">
                          Extension reason: {req.extension_reason}
                          {!req.extension_notified_at && " · requester notice pending"}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {(req.status === "submitted" || req.status === "in_progress") && (
                        <DsarActionButtons
                          requestId={req.id}
                          status={req.status}
                          requestType={req.type}
                          identityVerified={req.identity_verified}
                        />
                      )}
                      <DsarCaseControls
                        requestId={req.id}
                        viewerId={user.id}
                        assignedTo={req.assigned_to}
                        identityVerified={req.identity_verified}
                        canExtend={canExtend}
                        extensionDays={rule?.extension_days ?? 0}
                        isOpen={isOpen}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {total > PAGE_SIZE && (
        <nav aria-label="Data request pages" className="flex gap-4">
          {page > 1 && (
            <Link href={hrefFor(view, page - 1)} className="underline">
              Previous page
            </Link>
          )}
          {page * PAGE_SIZE < total && (
            <Link href={hrefFor(view, page + 1)} className="underline">
              Next page
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
