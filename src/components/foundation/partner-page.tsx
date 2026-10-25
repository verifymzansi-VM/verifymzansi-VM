import Link from "next/link";
import { redirect } from "next/navigation";
import { FoundationAccountBoundary } from "@/components/auth/foundation-account-boundary";
import {
  readFoundationServerSession,
  FoundationServerSessionError,
} from "@/lib/foundation/server-session";
import { readFoundationPartnerDashboard } from "@/lib/foundation/partners";
const money = (value: string) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(
    Number(value) / 100
  );
export async function FoundationPartnerPage() {
  const current = await readFoundationServerSession().catch((error) => {
    redirect(
      error instanceof FoundationServerSessionError && error.status === 401
        ? "/login?returnUrl=%2Fdashboard%2Fpartner"
        : "/error?reason=unavailable"
    );
  });
  const partner = await readFoundationPartnerDashboard(current.api);
  return (
    <FoundationAccountBoundary accountId={current.account.account_id}>
      <div className="space-y-6">
        <h1 className="font-display text-2xl font-bold">Partner programme</h1>
        {partner ? (
          <>
            <section className="space-y-3 rounded-2xl border bg-card p-5">
              <h2 className="font-semibold">Your referral link</h2>
              <p className="break-all">https://verifymzansi.com/?ref={partner.code}</p>
              <p>
                Status: {partner.status} · Commission rate: {partner.rate_bps / 100}%
              </p>
              <p>
                {partner.referrals} referrals · {partner.paying_referrals} paying referrals
              </p>
            </section>
            <section className="grid gap-4 sm:grid-cols-2">
              {Object.entries(partner.totals).map(([status, amount]) => (
                <article key={status} className="rounded-xl border p-5">
                  <h2 className="capitalize">{status}</h2>
                  <p className="mt-2 text-2xl font-semibold">{money(amount)}</p>
                </article>
              ))}
            </section>
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Recent commissions</h2>
              {!partner.recent.length && <p>No commissions yet.</p>}
              {partner.recent.map((item) => (
                <article key={item.id} className="rounded-xl border p-4">
                  <p>
                    {money(item.amount_cents)} · {item.status}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Created {new Date(item.created_at).toLocaleDateString("en-ZA")} · Eligible{" "}
                    {new Date(item.eligible_at).toLocaleDateString("en-ZA")}
                    {item.paid_at &&
                      ` · Paid ${new Date(item.paid_at).toLocaleDateString("en-ZA")}`}
                  </p>
                </article>
              ))}
            </section>
          </>
        ) : (
          <p className="rounded-xl border p-5">
            You are not currently a programme partner.{" "}
            <Link className="underline" href="/contact?topic=general_support">
              Contact us about joining
            </Link>
            .
          </p>
        )}
      </div>
    </FoundationAccountBoundary>
  );
}
