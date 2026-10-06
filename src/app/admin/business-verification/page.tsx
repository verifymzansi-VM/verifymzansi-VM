import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  ChevronRight,
  CircleAlert,
  Clock,
  Eye,
  UserCheck,
} from "lucide-react";

import { ClaimBadge, QueueClaimBar, QueueClaimsProvider } from "@/components/admin/queue-claims";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { roleHasCapability } from "@/lib/auth/admin-access";
import { requireStaff } from "@/lib/auth/require-staff";
import { listQueue, QUEUE_TABS, type QueueTab } from "@/lib/business-verification/admin-queries";
import { countMyClaims, getClaimsForItems, getMyClaimedItems } from "@/lib/services/queue-claims";
import { cn } from "@/lib/utils";
import { createLogger } from "@/lib/utils/logger";

export const metadata = {
  title: "Verify businesses — Admin",
  description: "Review CIPC documents, company representatives and business visits.",
};

const SLA_HOURS = 24;

function waited(iso: string) {
  const hours = Math.floor((Date.now() - Date.parse(iso)) / 3_600_000);
  return {
    hours,
    label: hours < 1 ? "just now" : hours < 48 ? `${hours} h` : `${Math.floor(hours / 24)} d`,
  };
}

export default async function AdminBusinessVerificationPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { user, role } = await requireStaff("queue:view");
  const requested = (await searchParams).tab;
  const tab: QueueTab = QUEUE_TABS.some((t) => t.key === requested)
    ? (requested as QueueTab)
    : "review";

  let data: Awaited<ReturnType<typeof listQueue>>;
  let myClaims = 0;
  try {
    const mine = await getMyClaimedItems(user.id, "business_kyc");
    [data, myClaims] = await Promise.all([
      listQueue(
        tab,
        mine.map((m) => m.id)
      ),
      countMyClaims(user.id, "business_kyc"),
    ]);
  } catch (error) {
    createLogger("AdminBusinessVerificationPage").error("Queue read failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return (
      <p role="alert">
        The business verification queue could not be loaded. Refresh to try again. This does not
        mean the queue is empty.
      </p>
    );
  }
  const claims = await getClaimsForItems(
    user.id,
    data.rows.map((r) => ({ type: "business_verification" as const, id: r.id }))
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Verify businesses"
        description="Claim cases to review them. Cases with the most red findings come first."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Business verification" }]}
      />

      <QueueClaimBar
        queue="business_kyc"
        myClaims={myClaims}
        canClaim={roleHasCapability(role, "queue:claim")}
      />

      <nav aria-label="Queue sections" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex w-max gap-1 rounded-2xl bg-muted p-1">
          {QUEUE_TABS.map((t) => {
            const count = data.counts[t.key];
            return (
              <li key={t.key}>
                <Link
                  href={`/admin/business-verification?tab=${t.key}`}
                  aria-current={t.key === tab ? "page" : undefined}
                  className={cn(
                    "inline-flex h-10 items-center gap-1.5 rounded-xl px-3.5 text-sm",
                    t.key === tab
                      ? "bg-background font-semibold shadow-sm"
                      : "text-muted-foreground"
                  )}
                >
                  {t.label}
                  {count ? <Badge variant="outline">{count}</Badge> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <QueueClaimsProvider
        claims={claims}
        mustClaim={role === "moderator"}
        canFree={roleHasCapability(role, "decision:approve")}
      >
        {data.rows.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            Nothing here right now.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.rows.map((r) => {
              const wait = waited(r.createdAt);
              const Icon =
                r.kind === "seen" ? Eye : r.route === "representative" ? UserCheck : Building2;
              return (
                <li key={r.id} className="rounded-2xl border bg-card">
                  <div className="flex flex-wrap items-center gap-3 p-4">
                    <Icon
                      aria-hidden="true"
                      className="h-5 w-5 shrink-0 text-brand-green-700 dark:text-brand-green-300"
                    />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/admin/business-verification/${r.id}`}
                        className="font-semibold underline-offset-2 hover:underline"
                      >
                        {r.businessName}
                      </Link>
                      <p className="text-sm text-muted-foreground">
                        {r.ownerName}
                        {r.registrationNumber ? ` · ${r.registrationNumber}` : ""}
                        {r.kind === "cipc_link" ? " · linked profile" : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      {r.red > 0 && (
                        <span className="inline-flex items-center gap-1 text-brand-red-700 dark:text-brand-red-300">
                          <CircleAlert aria-hidden="true" className="h-4 w-4" />
                          {r.red}
                          <span className="sr-only">items need attention</span>
                        </span>
                      )}
                      {r.amber > 0 && (
                        <span className="inline-flex items-center gap-1 text-brand-gold-800 dark:text-brand-gold-300">
                          <AlertTriangle aria-hidden="true" className="h-4 w-4" />
                          {r.amber}
                          <span className="sr-only">items to check</span>
                        </span>
                      )}
                      {tab !== "decided" ? (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1",
                            wait.hours >= SLA_HOURS
                              ? "font-semibold text-brand-red-700 dark:text-brand-red-300"
                              : "text-muted-foreground"
                          )}
                          title={`Target: ${SLA_HOURS} hours`}
                        >
                          <Clock aria-hidden="true" className="h-4 w-4" />
                          {wait.label}
                        </span>
                      ) : (
                        <Badge variant="outline">{r.status}</Badge>
                      )}
                      <ClaimBadge type="business_verification" id={r.id} />
                      <ChevronRight aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </QueueClaimsProvider>
    </div>
  );
}
