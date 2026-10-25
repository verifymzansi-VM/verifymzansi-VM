import Link from "next/link";
import { readFoundationStaffDashboard } from "@/lib/foundation/staff-dashboard";
import { formatSaLongDate } from "@/lib/utils/format";

export async function FoundationStaffHome() {
  const overview = await readFoundationStaffDashboard();
  const queues = [
    { key: "content" as const, label: "Posts awaiting moderation", href: "/admin/moderation" },
    { key: "reports" as const, label: "Open reports", href: "/admin/reports" },
    { key: "kyc" as const, label: "Identity checks", href: "/admin/verification" },
    {
      key: "business_kyc" as const,
      label: "Business checks",
      href: "/admin/business-verification",
    },
    {
      key: "decisions" as const,
      label: "Proposed decisions",
      href: "/admin/governance/escalations",
    },
  ];
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-2xl font-bold">Staff overview</h1>
        <p className="text-muted-foreground">Current queues and the work assigned to you.</p>
      </header>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Staff queues">
        {queues.map((queue) => (
          <Link key={queue.key} href={queue.href} className="rounded-lg border p-5 hover:bg-muted">
            <p className="text-sm text-muted-foreground">{queue.label}</p>
            <p className="mt-2 text-2xl font-bold">{overview.counts[queue.key]}</p>
          </Link>
        ))}
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Your current claims</h2>
        {overview.claims.length ? (
          <ul className="divide-y rounded-lg border">
            {overview.claims.map((claim) => (
              <li
                key={`${claim.kind}:${claim.subject_id}`}
                className="flex flex-wrap justify-between gap-3 p-4"
              >
                <Link
                  className="underline"
                  href={
                    claim.kind === "identity"
                      ? "/admin/verification"
                      : claim.kind === "report"
                        ? "/admin/reports"
                        : "/admin/moderation"
                  }
                >
                  {claim.kind === "identity"
                    ? "Identity check"
                    : claim.kind === "report"
                      ? "Report"
                      : "Content review"}
                </Link>
                <span className="text-sm text-muted-foreground">
                  Expires {formatSaLongDate(claim.expires_at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>You have no active claims.</p>
        )}
      </section>
      {overview.platform && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Platform operations</h2>
          <dl className="grid gap-4 rounded-lg border p-5 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-muted-foreground">Queued background events</dt>
              <dd className="font-semibold">{overview.platform.jobs_waiting}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Open cost alarms</dt>
              <dd className="font-semibold">{overview.platform.cost_alarms}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Active staff assignments</dt>
              <dd className="font-semibold">{overview.platform.active_staff}</dd>
            </div>
          </dl>
        </section>
      )}
    </div>
  );
}
