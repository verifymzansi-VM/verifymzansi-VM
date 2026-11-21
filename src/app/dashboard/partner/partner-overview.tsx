import Link from "next/link";
import { Download, MessageCircle } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { BrandSurface } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPlanPrice } from "@/lib/constants/pricing";
import { qrCodeSvg } from "@/lib/qr-code";
import {
  customerShortName,
  earnedThisMonth,
  nextPayoutCents,
  partnerReferralLink,
  whatsAppShareUrl,
  type PartnerDashboard,
} from "@/lib/partners/partner-overview";

/** A referred customer's name; the page shows only the short form. */
export interface PartnerCustomer {
  id: string;
  firstName: string;
  lastName: string;
}

/**
 * The redesigned partner page (SHOW_PARTNER_PAGE; frontend ledger group 80).
 * `customers` stays null until the partner summary returns referred customers'
 * names (checklist item 50); the section shows only when it does.
 */
export function PartnerOverview({
  partner,
  appUrl,
  now,
  customers = null,
}: {
  partner: PartnerDashboard;
  appUrl: string;
  now: Date;
  customers?: PartnerCustomer[] | null;
}) {
  const link = partnerReferralLink(appUrl, partner.code);
  const earned = earnedThisMonth(partner.recent, now);
  const qrHref = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrCodeSvg(link))}`;

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="Partner programme"
        description="Earn commission when businesses you introduce pay for VerifyMzansi plans."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Partner" }]}
      />

      <BrandSurface as="section" aria-label="This month" className="rounded-3xl px-5 py-6 sm:px-8">
        <dl className="relative grid grid-cols-2 gap-4">
          <div className="min-w-0">
            <dt className="text-sm text-white/70">Earned this month</dt>
            <dd className="font-display text-2xl font-bold tabular-nums text-white sm:text-4xl">
              {formatPlanPrice(earned.cents)}
            </dd>
            <dd className="mt-1 text-xs text-white/60">
              {earned.complete
                ? "Includes commission still in its 30-day wait."
                : "From your latest 50 commissions."}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-sm text-white/70">Next payout</dt>
            <dd className="font-display text-2xl font-bold tabular-nums text-brand-gold-300 sm:text-4xl">
              {formatPlanPrice(nextPayoutCents(partner.totals))}
            </dd>
            <dd className="mt-1 text-xs text-white/60">Approved commission only.</dd>
          </div>
        </dl>
      </BrandSurface>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle as="h2" className="text-lg">
                Share
              </CardTitle>
              <Badge variant={partner.status === "active" ? "default" : "secondary"}>
                {partner.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="break-all rounded-md bg-muted p-3 font-mono text-sm">{link}</p>
            <p className="text-sm text-muted-foreground">
              Code <strong className="text-foreground">{partner.code}</strong>
            </p>
            <div className="grid gap-2 sm:flex sm:flex-wrap">
              <Button asChild className="gap-1.5">
                <a href={whatsAppShareUrl(link)} target="_blank" rel="noopener noreferrer">
                  <MessageCircle aria-hidden="true" className="h-4 w-4" />
                  Share on WhatsApp
                </a>
              </Button>
              <Button asChild variant="outline" className="gap-1.5">
                <a href={qrHref} download={`verifymzansi-partner-${partner.code}.svg`}>
                  <Download aria-hidden="true" className="h-4 w-4" />
                  Download QR code
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle as="h2" className="text-lg">
              Progress
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Figures
              items={[
                ["Signed up", String(partner.referrals)],
                ["Paying", String(partner.payingReferrals)],
              ]}
            />
          </CardContent>
        </Card>

        {customers && customers.length > 0 ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle as="h2" className="text-lg">
                Customers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                {customers.map((customer) => (
                  <li key={customer.id}>
                    {customerShortName(customer.firstName, customer.lastName)}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle as="h2" className="text-lg">
              Money
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Figures
              items={[
                ["Pending", formatPlanPrice(partner.totals.PENDING ?? 0)],
                ["Approved", formatPlanPrice(partner.totals.APPROVED ?? 0)],
                ["Paid", formatPlanPrice(partner.totals.PAID ?? 0)],
              ]}
            />
            <p className="text-sm text-muted-foreground">
              {partner.rateBps / 100}% of each qualifying payment. Commission is pending for 30
              days, then approved if the payment stands.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle as="h2" className="text-lg">
              Help
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li>
                <Link className="underline" href="/terms#partners">
                  Partner rules
                </Link>
              </li>
              <li>
                <Link className="underline" href="/contact?topic=general_support">
                  Contact us
                </Link>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        No commission is paid on free trials, free events, invitation-only programmes,
        organisation-sponsored accounts, your own purchases, refunds or chargebacks.
      </p>
    </div>
  );
}

function Figures({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map(([name, value]) => (
        <div key={name} className="rounded-xl border p-3">
          <dt className="text-xs text-muted-foreground">{name}</dt>
          <dd className="font-display text-xl font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
