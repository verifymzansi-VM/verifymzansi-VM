import Link from "next/link";
import type React from "react";
import {
  ArrowRight,
  BadgeCheck,
  Ban,
  Building2,
  CheckCircle2,
  CreditCard,
  FileLock2,
  LifeBuoy,
  Mail,
  Scale,
  Siren,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import {
  getConfiguredContactRows,
  getConfiguredLegalIdentityRows,
  getTrustPublicConfig,
} from "@/lib/trust-public-config";

export const metadata = {
  title: "Trust & Safety",
  description:
    "How VerifyMzansi protects identity data, explains verification, handles payments, and helps South Africans trade more safely.",
};

const verificationLevels = [
  {
    name: "Phone verified",
    meaning: "The account has confirmed access to a South African mobile number.",
  },
  {
    name: "Email verified",
    meaning: "The account has confirmed access to its email address.",
  },
  {
    name: "ID evidence reviewed",
    meaning: "The person posting submitted ID evidence and a selfie for review.",
  },
  {
    name: "Location verified",
    meaning: "The user saved a South African location and may have matched it with device GPS.",
  },
  {
    name: "Official representative reviewed",
    meaning: "The person posting for a business completed representative review.",
  },
  {
    name: "Payment verified",
    meaning: "A paid feature was processed through the platform's payment flow.",
  },
] as const;

const safetyRules = [
  "Never pay deposits before seeing goods or confirming the seller.",
  "Meet in safe public places and tell someone where you are going.",
  "Avoid courier, EFT, e-wallet, and OTP pressure tactics.",
  "Keep chats, payment references, listings, and profile links.",
  "Report suspicious listings before continuing a deal.",
] as const;

const dataPractices = [
  "Identity, phone, and location data is collected for verification, fraud prevention, safety, and legal compliance.",
  "Verification files are encrypted and stored with restricted reviewer access.",
  "Trusted service providers may process data where needed to run the service.",
  "Users can request access, correction, deletion, or objection through the POPIA process.",
] as const;

const integrityMetrics = [
  { label: "Verified users", value: "Launching" },
  { label: "Reviewed representatives", value: "Launching" },
  { label: "Listings removed", value: "Tracked internally" },
  { label: "Fraud reports reviewed", value: "Tracked internally" },
  { label: "Average response time", value: "1-2 business days" },
  { label: "Last security review", value: "April 2026" },
] as const;

const reportSteps = [
  {
    title: "Stop the deal",
    description: "Do not send more money, codes, documents, or private banking details.",
  },
  {
    title: "Keep evidence",
    description: "Save listing links, chats, screenshots, payment references, and profile names.",
  },
  {
    title: "Report it",
    description: "Send the evidence to VerifyMzansi and report criminal matters to SAPS.",
  },
] as const;

function SafetyPanel({
  title,
  icon: Icon,
  tone = "default",
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "default" | "warning" | "secure";
  children: React.ReactNode;
}) {
  const toneClasses = {
    default: "border-border bg-background",
    warning: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30",
    secure: "border-brand-green/20 bg-brand-green/5",
  }[tone];

  return (
    <section className={`rounded-lg border p-4 sm:p-5 ${toneClasses}`}>
      <div className="space-y-3">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold sm:text-lg">
          <Icon
            className={`h-4 w-4 shrink-0 ${
              tone === "warning" ? "text-amber-700 dark:text-amber-300" : "text-brand-green"
            }`}
            aria-hidden="true"
          />
          {title}
        </h2>
        <div className="space-y-3 text-sm leading-6 text-muted-foreground">{children}</div>
      </div>
    </section>
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
        <div className="container-page space-y-6 py-4 sm:py-6">
          <PageHeader
            title="Trust & Safety"
            description="Start here before you meet, pay, share documents, or trust a verification badge."
            breadcrumbs={[{ label: "Trust & Safety" }]}
          />

          <section className="overflow-hidden rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
            <div className="grid gap-0 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
              <div className="space-y-5 p-5 sm:p-6">
                <div className="flex max-w-3xl items-start gap-3">
                  <Siren
                    className="mt-1 h-6 w-6 shrink-0 text-amber-700 dark:text-amber-300"
                    aria-hidden="true"
                  />
                  <div className="space-y-2">
                    <h2 className="font-display text-2xl font-semibold tracking-normal text-amber-950 dark:text-amber-100 sm:text-3xl">
                      Stay safe before you continue a deal.
                    </h2>
                    <p className="max-w-2xl text-sm leading-6 text-amber-900 dark:text-amber-100">
                      Verification reduces risk, but it does not guarantee a product, seller, buyer,
                      rental, job, business, or event. If a deal feels rushed, private, or
                      confusing, pause first.
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {safetyRules.map((rule) => (
                    <div key={rule} className="flex gap-2 rounded-md bg-background/70 p-3">
                      <Ban className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
                      <p className="text-sm leading-5 text-foreground">{rule}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-amber-200 bg-background p-5 dark:border-amber-900 lg:border-l lg:border-t-0">
                <h3 className="font-display text-base font-semibold">If something feels wrong</h3>
                <ol className="mt-4 space-y-4">
                  {reportSteps.map((step, index) => (
                    <li key={step.title} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-sm font-semibold text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                        {index + 1}
                      </span>
                      <div>
                        <h4 className="text-sm font-semibold">{step.title}</h4>
                        <p className="mt-1 text-sm leading-5 text-muted-foreground">
                          {step.description}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Link
                    href="/safety"
                    className="inline-flex min-h-10 items-center gap-2 rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-green/90"
                  >
                    Open Safety Centre
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                  <a
                    href={`mailto:${trustConfig.supportEmail}`}
                    className="inline-flex min-h-10 items-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold transition-colors hover:bg-muted"
                  >
                    Report concern
                  </a>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <div className="max-w-3xl space-y-1">
              <h2 className="font-display text-xl font-semibold">What verification means</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                Badges show completed platform checks. They are signals to consider, not promises
                that a deal is safe.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {verificationLevels.map((level) => (
                <div key={level.name} className="rounded-lg border bg-background p-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <BadgeCheck className="h-4 w-4 shrink-0 text-brand-green" aria-hidden="true" />
                    {level.name}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{level.meaning}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <SafetyPanel title="Payments and refunds" icon={CreditCard}>
              <p>
                Paid visibility is processed through secure hosted checkout in South African rand.
                The checkout should show VerifyMzansi
                {trustConfig.ozowMerchantName ? ` or ${trustConfig.ozowMerchantName}` : ""} as the
                expected merchant name.
              </p>
              <p>
                Listings remain subject to moderation. Refund handling follows the Terms of Service,
                consumer law, and the payment provider record.
              </p>
              {trustConfig.vatStatus && <p>VAT status: {trustConfig.vatStatus}</p>}
            </SafetyPanel>

            <SafetyPanel title="Accountability channels" icon={LifeBuoy} tone="secure">
              <p>
                Send fraud reports, data-rights requests, verification appeals, and security
                concerns through the correct support channel.
              </p>
              <div className="grid gap-2">
                <a
                  href={`mailto:${trustConfig.supportEmail}`}
                  className="inline-flex items-center gap-2"
                >
                  <Mail className="h-3.5 w-3.5" />
                  {trustConfig.supportEmail}
                </a>
                <a
                  href={`mailto:${trustConfig.securityEmail}`}
                  className="inline-flex items-center gap-2"
                >
                  <Scale className="h-3.5 w-3.5" />
                  {trustConfig.securityEmail}
                </a>
              </div>
            </SafetyPanel>
          </div>

          <section className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <SafetyPanel title="POPIA and identity data" icon={FileLock2}>
              <ul className="space-y-2">
                {dataPractices.map((practice) => (
                  <li key={practice} className="flex gap-2">
                    <CheckCircle2
                      className="mt-0.5 h-4 w-4 shrink-0 text-brand-green"
                      aria-hidden="true"
                    />
                    <span>{practice}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-3 pt-1">
                <Link href="/privacy" className="text-brand-green underline">
                  Read the Privacy Policy
                </Link>
                <Link href="/dsar" className="text-brand-green underline">
                  Open the POPIA request form
                </Link>
              </div>
            </SafetyPanel>

            <SafetyPanel title="PAIA and POPIA process" icon={Scale}>
              <p>
                Users can request access, correction, deletion, objection, recipient information, or
                account-data export.
              </p>
              <p>
                The PAIA manual explains record requests, data-subject requests, and escalation
                routes.
              </p>
              <Link href="/paia" className="block text-brand-green underline">
                Open the PAIA manual
              </Link>
              <p>
                If a POPIA issue is not resolved through VerifyMzansi first, users may escalate to
                the Information Regulator South Africa.
              </p>
            </SafetyPanel>
          </section>

          <section className="rounded-lg border bg-muted/30 p-4 sm:p-5">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="space-y-2">
                <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
                  <Building2 className="h-4 w-4 text-brand-green" aria-hidden="true" />
                  Company and platform transparency
                </h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  These details help users check who operates the service after they understand the
                  immediate safety guidance.
                </p>
                <p className="text-sm leading-6 text-muted-foreground">
                  You can independently verify our registration on CIPC using registration number{" "}
                  {trustConfig.cipcNumber}.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <h3 className="text-sm font-semibold">Business identity</h3>
                  <dl className="mt-3 grid gap-2">
                    {legalIdentityRows.map((row) => (
                      <div key={row.label} className="rounded-md border bg-background px-3 py-2">
                        <dt className="text-xs font-medium text-foreground">{row.label}</dt>
                        <dd className="mt-1 break-words text-sm text-muted-foreground">
                          {row.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>

                <div>
                  <h3 className="text-sm font-semibold">Contact details</h3>
                  <dl className="mt-3 grid gap-2">
                    {contactRows.map((row) => (
                      <div key={row.label} className="rounded-md border bg-background px-3 py-2">
                        <dt className="text-xs font-medium text-foreground">{row.label}</dt>
                        <dd className="mt-1 break-words text-sm text-muted-foreground">
                          {row.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <div className="max-w-3xl space-y-1">
              <h2 className="font-display text-xl font-semibold">Platform integrity</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                Public integrity figures are tracked as the marketplace launches and moderation data
                matures.
              </p>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {integrityMetrics.map((metric) => (
                <div key={metric.label} className="rounded-lg border bg-background p-4">
                  <dt className="text-xs font-medium uppercase text-muted-foreground">
                    {metric.label}
                  </dt>
                  <dd className="mt-2 text-sm font-semibold text-foreground">{metric.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
