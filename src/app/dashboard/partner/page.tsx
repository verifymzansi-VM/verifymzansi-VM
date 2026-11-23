import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { formatPlanPrice } from "@/lib/constants/pricing";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { readFoundationPartnerDashboard } from "@/lib/foundation/partners";
import { SHOW_PARTNER_PAGE } from "@/lib/hidden-features";
import type { PartnerDashboard } from "@/lib/partners/partner-overview";
import { PartnerOverview, RecentCommission } from "./partner-overview";

export const metadata = { title: "Partner programme", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function PartnerDashboardPage() {
  const partner = await readNativeDashboard();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com";

  // The redesigned page (frontend ledger group 80) stays off until the partner
  // agreement is signed; until then partners see the page below, unchanged.
  if (SHOW_PARTNER_PAGE && partner)
    return <PartnerOverview partner={partner} appUrl={appUrl} now={new Date()} />;
  return <PartnerDashboardContent partner={partner} appUrl={appUrl} />;
}

async function readNativeDashboard(): Promise<PartnerDashboard | null> {
  const { api } = await readFoundationServerSession();
  const partner = await readFoundationPartnerDashboard(api);
  if (!partner) return null;
  return {
    code: partner.code,
    status: partner.status,
    rateBps: partner.rate_bps,
    referrals: partner.referrals,
    payingReferrals: partner.paying_referrals,
    totals: Object.fromEntries(
      Object.entries(partner.totals).map(([status, value]) => [status.toUpperCase(), Number(value)])
    ),
    recent: partner.recent.map((row) => ({
      id: row.id,
      amountCents: Number(row.amount_cents),
      baseCents: Number(row.base_cents),
      status: row.status.toUpperCase(),
      createdAt: row.created_at,
      eligibleAt: row.eligible_at,
      manual: false,
    })),
  };
}

function PartnerDashboardContent({
  partner,
  appUrl,
}: {
  partner: PartnerDashboard | null;
  appUrl: string;
}) {
  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="Partner programme"
        description="Earn commission when businesses you introduce pay for VerifyMzansi plans."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Partner" }]}
      />

      {!partner ? (
        <section className="rounded-xl border p-5 text-sm">
          <p>
            You are not a VerifyMzansi partner yet. Partners earn a share of collected retail
            revenue from the businesses they refer.
          </p>
          <Link className="mt-2 inline-block underline" href="/contact?topic=general_support">
            Ask about becoming a partner
          </Link>
        </section>
      ) : (
        <>
          <section className="space-y-2 rounded-xl border p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">Your referral link</h2>
              <Badge variant={partner.status === "active" ? "default" : "secondary"}>
                {partner.status}
              </Badge>
            </div>
            <p className="break-all rounded-md bg-muted p-3 font-mono text-sm">
              {appUrl}/?ref={partner.code}
            </p>
            <p className="text-sm text-muted-foreground">
              Code <strong>{partner.code}</strong> · A share of each qualifying payment. Commission
              is pending for a waiting period, then approved if the payment stands.
            </p>
          </section>

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Referred accounts", String(partner.referrals)],
              ["Paying referrals", String(partner.payingReferrals)],
              ["Pending", formatPlanPrice(partner.totals.PENDING ?? 0)],
              [
                "Approved / paid",
                formatPlanPrice((partner.totals.APPROVED ?? 0) + (partner.totals.PAID ?? 0)),
              ],
            ].map(([name, value]) => (
              <div key={name} className="rounded-xl border p-3">
                <dt className="text-xs text-muted-foreground">{name}</dt>
                <dd className="font-display text-xl font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>

          <RecentCommission recent={partner.recent} />
          <p className="text-xs text-muted-foreground">
            No commission is paid on free trials, free events, invitation-only programmes,
            organisation-sponsored accounts, your own purchases, refunds or chargebacks.
          </p>
        </>
      )}
    </div>
  );
}
