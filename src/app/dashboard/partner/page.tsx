import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { formatPlanPrice } from "@/lib/constants/pricing";

export const metadata = { title: "Partner programme", robots: { index: false } };
export const dynamic = "force-dynamic";

interface PartnerDashboard {
  code: string;
  status: string;
  rateBps: number;
  referrals: number;
  payingReferrals: number;
  totals: Record<string, number>;
  recent: Array<{
    id: string;
    amountCents: number;
    baseCents: number;
    status: string;
    createdAt: string;
    eligibleAt: string;
    manual: boolean;
  }>;
}

const date = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "medium",
  timeZone: "Africa/Johannesburg",
});
const STATUS_TEXT: Record<string, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  PAID: "Paid",
  REVERSED: "Reversed",
};

export default async function PartnerDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?returnUrl=/dashboard/partner");

  const { data } = await createAdminClient().rpc("partner_dashboard", { p_user: user.id });
  const partner = (data ?? null) as PartnerDashboard | null;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com";

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
              Code <strong>{partner.code}</strong> · {partner.rateBps / 100}% of each qualifying
              payment. Commission is pending for 30 days, then approved if the payment stands.
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

          <section className="space-y-2">
            <h2 className="text-base font-semibold">Recent commission</h2>
            {partner.recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">No commission yet.</p>
            ) : (
              <ul className="space-y-2">
                {partner.recent.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"
                  >
                    <span className="font-semibold">{formatPlanPrice(row.amountCents)}</span>
                    <span className="text-muted-foreground">
                      on {formatPlanPrice(row.baseCents)} · {date.format(new Date(row.createdAt))}
                    </span>
                    <Badge variant={row.status === "REVERSED" ? "secondary" : "outline"}>
                      {STATUS_TEXT[row.status] ?? row.status}
                    </Badge>
                    {row.status === "PENDING" ? (
                      <span className="text-xs text-muted-foreground">
                        {row.manual
                          ? "Awaiting manual approval"
                          : `Eligible ${date.format(new Date(row.eligibleAt))}`}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="text-xs text-muted-foreground">
            No commission is paid on free trials, free events, invitation-only programmes,
            organisation-sponsored accounts, your own purchases, refunds or chargebacks.
            Organisation and enterprise contracts are approved individually.
          </p>
        </>
      )}
    </div>
  );
}
