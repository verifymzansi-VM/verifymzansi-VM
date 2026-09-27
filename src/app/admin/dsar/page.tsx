import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelativeTime, formatSaShortDate } from "@/lib/utils/format";
import { maskEmail } from "@/lib/utils/mask";
import { Download, FileText } from "lucide-react";
import { DsarActionButtons } from "./dsar-action-buttons";
import { verifyCapabilityFromDb } from "@/lib/auth/admin-access";
import { createLogger } from "@/lib/utils/logger";
import type { DsarCase } from "@/types/database";
import type { DsarStatus } from "@/types/enums";

export const metadata = {
  title: "Data Requests — Admin",
  description: "Process POPIA data subject access and deletion requests.",
};

const OPEN_STATUSES: DsarStatus[] = ["submitted", "identity_pending", "in_progress"];
const CLOSED_STATUSES: DsarStatus[] = ["completed", "rejected"];
const PAGE_SIZE = 25;

type DsarView = "open" | "closed";

/** Server-rendered per request, so reading the clock here is deterministic for the response. */
function isPastDue(dueBy: string): boolean {
  return new Date(dueBy).getTime() < Date.now();
}

export default async function AdminDSARPage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string; page?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await verifyCapabilityFromDb(user, "dsar:manage"))) {
    redirect("/dashboard");
  }

  const params = (await searchParams) ?? {};
  const view: DsarView = params.view === "closed" ? "closed" : "open";
  const parsedPage = Number(params.page || 1);
  const page =
    Number.isSafeInteger(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 100_000) : 1;

  const admin = createAdminClient();

  // Open cases are ordered by statutory due date so the most urgent is first;
  // closed cases are newest first. Every case stays reachable through paging.
  let query = admin
    .from("dsar_cases")
    .select("*", { count: "exact" })
    .in("status", view === "open" ? OPEN_STATUSES : CLOSED_STATUSES);
  query =
    view === "open"
      ? query.order("due_by", { ascending: true, nullsFirst: true })
      : query.order("created_at", { ascending: false });
  const {
    data: requests,
    error,
    count,
  } = await query
    .order("id", { ascending: true })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (error) {
    createLogger("AdminDSAR").error("DSAR read failed", { error: error.message });
    return (
      <p role="alert">
        Data requests could not be loaded. Refresh to try again. This does not mean there are no
        requests.
      </p>
    );
  }

  const total = count ?? requests?.length ?? 0;
  const hrefFor = (nextView: DsarView, nextPage = 1) =>
    `/admin/dsar?view=${nextView}${nextPage > 1 ? `&page=${nextPage}` : ""}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data Requests"
        description="Manage POPIA data requests."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Data Requests" }]}
      />

      <nav aria-label="Data request status" className="flex gap-2">
        {(["open", "closed"] as const).map((v) => (
          <Button key={v} asChild size="sm" variant={v === view ? "default" : "outline"}>
            <Link href={hrefFor(v)} aria-current={v === view ? "page" : undefined}>
              {v === "open" ? "Open" : "Closed"}
            </Link>
          </Button>
        ))}
      </nav>

      <p className="text-sm text-muted-foreground">
        {total} {view} {total === 1 ? "request" : "requests"}
        {total > PAGE_SIZE && ` · Page ${page} of ${Math.ceil(total / PAGE_SIZE)}`}
      </p>

      {!requests?.length ? (
        <div className="text-center py-6 text-muted-foreground">
          <FileText className="h-8 w-8 mx-auto mb-3" />
          <p>{view === "open" ? "No open data requests." : "No closed data requests."}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((req: DsarCase) => (
            <Card key={req.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px]">
                        {req.type || "access"}
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
                        {req.status}
                      </Badge>
                    </div>
                    <p className="text-sm">{maskEmail(req.requester_email)}</p>
                    {req.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {req.description}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Received {formatRelativeTime(req.created_at)}
                      {req.due_by && view === "open" && (
                        <>
                          {" · "}
                          <span
                            className={
                              isPastDue(req.due_by) ? "font-semibold text-destructive" : undefined
                            }
                          >
                            {isPastDue(req.due_by) ? "Overdue since" : "Due"}{" "}
                            {formatSaShortDate(req.due_by)}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  {(req.status === "submitted" || req.status === "in_progress") && (
                    <DsarActionButtons
                      requestId={req.id}
                      status={req.status}
                      requestType={req.type}
                      identityVerified={req.identity_verified}
                    />
                  )}
                  <Button asChild variant="outline" size="sm" className="gap-2">
                    <a href={`/api/admin/dsar/export?requestId=${req.id}`}>
                      <Download className="h-4 w-4" />
                      <span>Export JSON</span>
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
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
