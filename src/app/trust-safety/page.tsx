import Link from "next/link";
import type React from "react";
import {
  Building2,
  Check,
  CreditCard,
  Eye,
  FileLock2,
  Fingerprint,
  LifeBuoy,
  Mail,
  MapPin,
  Scale,
  Smartphone,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { BrandShield } from "@/components/shared/brand-shield";
import { brandOutlineButtonClassName } from "@/components/brand";
import { InfoHero, SectionHeading } from "@/components/safety/info-hero";
import { TrustBadge } from "@/components/trust/trust-badge";
import { VerifiedTick } from "@/components/trust/verified-tick";
import { Button } from "@/components/ui/button";
import { SAFETY_RULES as safetyRules } from "@/lib/constants/safety-rules";
import { TRUST_TIERS } from "@/lib/constants/trust-scale";
import {
  getConfiguredContactRows,
  getConfiguredLegalIdentityRows,
  getTrustPublicConfig,
} from "@/lib/trust-public-config";
import type { TrustLevel } from "@/types/enums";

export const metadata = {
  title: "Trust & Safety",
  description:
    "How VerifyMzansi protects identity data, explains verification, handles payments, and helps South Africans trade more safely.",
};

const journeySteps = [
  { icon: Smartphone, title: "Phone confirmed", body: "One-time code to an SA number." },
  {
    icon: Fingerprint,
    title: "ID & selfie reviewed",
    body: "Checked by our team, then encrypted.",
  },
  { icon: MapPin, title: "Area shared", body: "Province and city, as given by the poster." },
  { icon: BrandShield, title: "Badge shown", body: "On their profile and posts." },
] as const;

const businessStickers = [
  { icon: Building2, label: "CIPC registered" },
  { icon: Eye, label: "Seen by VerifyMzansi" },
] as const;

const tierOrder: TrustLevel[] = [3, 4, 2, 1, 0];

const reportSteps = [
  { title: "Stop the deal", description: "No more money, codes or documents." },
  { title: "Keep evidence", description: "Save chats, links and payment references." },
  { title: "Report it", description: "Tell us, and SAPS for crimes." },
] as const;

const textLink =
  "font-semibold text-brand-green-700 underline underline-offset-4 hover:text-brand-green-800 dark:text-brand-green-300 dark:hover:text-brand-green-200";

function InfoCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="surface-card flex flex-col p-5">
      <span className="icon-tile area-market-tile">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <h3 className="mt-4 font-body text-base font-semibold text-foreground">{title}</h3>
      <div className="mt-1.5 flex-1 space-y-2 text-sm leading-6 text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

function ExampleProfileCard() {
  return (
    <div className="hero-panel p-6">
      <p className="text-xs font-medium text-muted-foreground">How your reviewed profile looks</p>
      <div className="mt-4 flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-gold-100 font-display text-lg font-bold text-brand-gold-900 dark:bg-brand-gold-900/40 dark:text-brand-gold-200"
        >
          You
        </span>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-semibold text-foreground">
            Your name
            <VerifiedTick />
          </p>
          <p className="text-sm text-muted-foreground">Your town</p>
        </div>
      </div>
      <TrustBadge level={3} size="lg" className="mt-4" />
      <ul className="mt-5 space-y-2.5 border-t border-border/60 pt-4">
        {journeySteps.slice(0, 3).map(({ title }) => (
          <li key={title} className="flex items-center gap-2.5 text-sm text-foreground/85">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-green/15 text-brand-green-700 dark:text-brand-green-300">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            {title}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function TrustSafetyPage() {
  const trustConfig = getTrustPublicConfig();
  const legalIdentityRows = getConfiguredLegalIdentityRows(trustConfig);
  const contactRows = getConfiguredContactRows(trustConfig);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main id="main-content" className="flex-1">
        <InfoHero
          title="Trust & Safety"
          description="Verification helps reduce risk, but it does not replace your own checks."
          breadcrumbs={[{ label: "Trust & Safety" }]}
          actions={
            <>
              <Button asChild variant="trust-verified" size="lg">
                <Link href="/safety">Safety tips</Link>
              </Button>
              <Button asChild variant="outline" size="lg" className={brandOutlineButtonClassName}>
                <Link href="/contact?topic=fraud_report">Report a concern</Link>
              </Button>
            </>
          }
          aside={<ExampleProfileCard />}
        />

        <div className="container-page space-y-14 py-10 sm:space-y-20 sm:py-14">
          {/* ── Verification journey ─────────────────────────────── */}
          <section aria-labelledby="journey-title">
            <SectionHeading
              id="journey-title"
              title="How someone gets verified"
              lede="VerifyMzansi verifies people who post. Badges are signals, not promises."
            />

            <ol className="mt-8 grid gap-4 lg:grid-cols-4 lg:gap-6">
              {journeySteps.map(({ icon: Icon, title, body }, index) => (
                <li key={title} className="relative flex gap-4 lg:flex-col lg:gap-0">
                  {index < journeySteps.length - 1 && (
                    <span
                      aria-hidden="true"
                      className="absolute -bottom-4 left-6 top-14 w-px bg-brand-green/30 lg:-right-6 lg:bottom-auto lg:left-16 lg:top-6 lg:h-px lg:w-auto"
                    />
                  )}
                  <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-green-600 text-white elev-sm dark:bg-brand-green-500 dark:text-brand-green-950">
                    <Icon className="h-6 w-6" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 pb-4 lg:mt-4 lg:pb-0">
                    <p className="text-xs font-semibold text-brand-green-700 dark:text-brand-green-300">
                      Step {index + 1}
                    </p>
                    <h3 className="mt-0.5 font-body text-base font-semibold text-foreground">
                      {title}
                    </h3>
                    <p className="mt-0.5 text-sm leading-6 text-muted-foreground">{body}</p>
                    {index === journeySteps.length - 1 && (
                      <p className="mt-2.5 flex flex-wrap items-center gap-2">
                        <TrustBadge level={3} />
                        <VerifiedTick decorative />
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Businesses can also earn:</span>
              {businessStickers.map(({ icon: Icon, label }) => (
                <span key={label} className="chip">
                  <Icon
                    className="h-3.5 w-3.5 text-brand-green-700 dark:text-brand-green-300"
                    aria-hidden="true"
                  />
                  {label}
                </span>
              ))}
              <Link
                href="/help/business-verification"
                className="text-sm font-semibold text-brand-green-700 underline-offset-2 hover:underline dark:text-brand-green-300"
              >
                What each sticker means
              </Link>
            </div>
          </section>

          {/* ── Badge levels ─────────────────────────────────────── */}
          <section
            aria-labelledby="badges-title"
            className="grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-14"
          >
            <div>
              <SectionHeading
                id="badges-title"
                title="What each badge means"
                lede="Badges describe account checks. They are not a guarantee."
              />
              <ul className="mt-6 space-y-2.5 text-sm text-foreground/85">
                <li className="flex items-center gap-2.5">
                  <VerifiedTick className="h-5 w-5" decorative />
                  Green tick: ID Reviewed
                </li>
                <li className="flex items-center gap-2.5">
                  <VerifiedTick className="h-5 w-5" pro decorative />
                  Marigold tick: ID Reviewed Pro
                </li>
              </ul>
            </div>

            <ul className="divide-y divide-border/70 overflow-hidden rounded-3xl border border-border/70 bg-card elev-xs">
              {tierOrder.map((level) => (
                <li
                  key={level}
                  className="grid gap-2 px-5 py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-center sm:gap-5"
                >
                  <div>
                    <TrustBadge level={level} size="lg" />
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {TRUST_TIERS[level].description}.
                    {level === 4 && " Pro adds visibility, not a higher safety rating."}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          {/* ── Safe dealing ─────────────────────────────────────── */}
          <section aria-labelledby="deal-title">
            <SectionHeading id="deal-title" title="Before you continue a deal" />
            <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <ul className="surface-card divide-y divide-border/60">
                {safetyRules.map((rule) => (
                  <li key={rule} className="flex items-center gap-3 px-4 py-3.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-gold/15 text-brand-gold-800 dark:text-brand-gold-300">
                      <BrandShield className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <p className="text-sm leading-6 text-foreground">{rule}</p>
                  </li>
                ))}
              </ul>

              <div className="rounded-3xl bg-warm-900 p-6 text-white dark:bg-card dark:text-foreground dark:ring-1 dark:ring-border">
                <h3 className="font-display text-xl font-bold">If something feels wrong</h3>
                <ol className="mt-5 space-y-4">
                  {reportSteps.map((step, index) => (
                    <li key={step.title} className="flex gap-3.5">
                      <span
                        aria-hidden="true"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-gold text-sm font-bold text-brand-gold-950"
                      >
                        {index + 1}
                      </span>
                      <div>
                        <h4 className="text-sm font-semibold">{step.title}</h4>
                        <p className="text-sm leading-6 text-white/75 dark:text-muted-foreground">
                          {step.description}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
                <div className="mt-6 flex flex-wrap gap-2.5">
                  <Button asChild variant="trust-gold">
                    <Link href="/contact?topic=fraud_report">Report a concern</Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    className="border-white/25 bg-transparent text-white hover:bg-white/10 dark:border-input dark:text-foreground dark:hover:bg-muted"
                  >
                    <Link href="/safety/scam-alerts">Common scams</Link>
                  </Button>
                </div>
              </div>
            </div>
          </section>

          {/* ── Data, rights & payments ─────────────────────────── */}
          <section aria-labelledby="data-title">
            <SectionHeading id="data-title" title="Your data, rights and payments" />
            <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <InfoCard title="Identity data" icon={FileLock2}>
                <p>Used only for verification, fraud prevention and the law. Stored encrypted.</p>
                <p className="flex flex-col gap-1">
                  <Link href="/privacy" className={textLink}>
                    Privacy Policy
                  </Link>
                  <Link href="/dsar" className={textLink}>
                    POPIA request form
                  </Link>
                </p>
              </InfoCard>

              <InfoCard title="PAIA and POPIA" icon={Scale}>
                <p>Request, correct or delete your data. Escalate to the Information Regulator.</p>
                <Link href="/paia" className={`block ${textLink}`}>
                  PAIA manual
                </Link>
              </InfoCard>

              <InfoCard title="Payments" icon={CreditCard}>
                <p>
                  Secure hosted checkout in rand. Expect VerifyMzansi
                  {trustConfig.ozowMerchantName ? ` or ${trustConfig.ozowMerchantName}` : ""} as the
                  merchant.
                </p>
                {trustConfig.vatStatus && <p>VAT status: {trustConfig.vatStatus}</p>}
              </InfoCard>

              <InfoCard title="Support channels" icon={LifeBuoy}>
                <div className="grid gap-1">
                  <a
                    href={`mailto:${trustConfig.supportEmail}`}
                    className="inline-flex min-h-10 items-center gap-2 break-all font-medium text-foreground hover:text-brand-green-700 dark:hover:text-brand-green-300"
                  >
                    <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {trustConfig.supportEmail}
                  </a>
                  <a
                    href={`mailto:${trustConfig.securityEmail}`}
                    className="inline-flex min-h-10 items-center gap-2 break-all font-medium text-foreground hover:text-brand-green-700 dark:hover:text-brand-green-300"
                  >
                    <Scale className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {trustConfig.securityEmail}
                  </a>
                </div>
              </InfoCard>
            </div>
          </section>

          {/* ── Company transparency ─────────────────────────────── */}
          <section aria-labelledby="company-title" className="hero-panel p-5 sm:p-8">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:gap-12">
              <div>
                <span className="icon-tile area-market-tile">
                  <Building2 className="h-5 w-5" aria-hidden="true" />
                </span>
                <h2 id="company-title" className="mt-4 section-title">
                  Who runs VerifyMzansi
                </h2>
                <p className="section-lede">Check us on CIPC: {trustConfig.cipcNumber}.</p>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Business identity</h3>
                  <dl className="mt-3 divide-y divide-border/60 rounded-2xl border border-border/60 bg-background/60">
                    {legalIdentityRows.map((row) => (
                      <div key={row.label} className="px-4 py-3">
                        <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
                        <dd className="mt-0.5 break-words text-sm font-medium text-foreground">
                          {row.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-foreground">Contact details</h3>
                  <dl className="mt-3 divide-y divide-border/60 rounded-2xl border border-border/60 bg-background/60">
                    {contactRows.map((row) => (
                      <div key={row.label} className="px-4 py-3">
                        <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
                        <dd className="mt-0.5 break-words text-sm font-medium text-foreground">
                          {row.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
