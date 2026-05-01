import Link from "next/link";
import type React from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  CreditCard,
  FileLock2,
  LifeBuoy,
  Mail,
  ShieldAlert,
  Scale,
  ShieldCheck,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

function TrustCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-brand-green" aria-hidden="true" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">{children}</CardContent>
    </Card>
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
        <div className="container-page py-4 space-y-5">
          <PageHeader
            title="Trust & Safety"
            description="How VerifyMzansi handles verification, safety, payments, and identity data."
            breadcrumbs={[{ label: "Trust & Safety" }]}
          />

          <section className="rounded-lg border border-brand-green/20 bg-brand-green/5 p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-green" />
              <div className="space-y-1">
                <h2 className="font-display text-lg font-semibold">
                  Verification helps reduce risk, but it does not guarantee safety.
                </h2>
                <p className="text-sm text-muted-foreground">
                  A verified badge means an account completed platform checks. It does not guarantee
                  a product, deal, business, rental, job, or event.
                </p>
              </div>
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <TrustCard title="Business identity" icon={Building2}>
              <dl className="grid gap-2">
                {legalIdentityRows.map((row) => (
                  <div key={row.label} className="rounded-md border bg-background px-3 py-2">
                    <dt className="text-xs font-medium text-foreground">{row.label}</dt>
                    <dd className="mt-1 break-words">{row.value}</dd>
                  </div>
                ))}
              </dl>
              <dl className="grid gap-2">
                {contactRows.map((row) => (
                  <div key={row.label} className="rounded-md border bg-background px-3 py-2">
                    <dt className="text-xs font-medium text-foreground">{row.label}</dt>
                    <dd className="mt-1 break-words">{row.value}</dd>
                  </div>
                ))}
              </dl>
              <p>
                You can independently verify our registration on CIPC using registration number{" "}
                {trustConfig.cipcNumber}.
              </p>
            </TrustCard>

            <TrustCard title="POPIA and identity data" icon={FileLock2}>
              <ul className="space-y-2">
                {dataPractices.map((practice) => (
                  <li key={practice} className="flex gap-2">
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-green" />
                    <span>{practice}</span>
                  </li>
                ))}
              </ul>
              <Link href="/privacy" className="block text-brand-green underline">
                Read the Privacy Policy
              </Link>
              <Link href="/dsar" className="block text-brand-green underline">
                Open the POPIA data-subject request form
              </Link>
            </TrustCard>
          </div>

          <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <TrustCard title="PAIA and POPIA process" icon={Scale}>
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
            </TrustCard>

            <TrustCard title="Platform Integrity" icon={ShieldAlert}>
              <dl className="grid grid-cols-2 gap-2">
                {integrityMetrics.map((metric) => (
                  <div key={metric.label} className="rounded-md border bg-background px-3 py-2">
                    <dt className="text-xs font-medium text-foreground">{metric.label}</dt>
                    <dd className="mt-1">{metric.value}</dd>
                  </div>
                ))}
              </dl>
            </TrustCard>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-lg font-semibold">How verification works</h2>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {verificationLevels.map((level) => (
                <Card key={level.name}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <BadgeCheck className="h-4 w-4 text-brand-green" />
                      {level.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    {level.meaning}
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-3">
            <TrustCard title="Buyer and seller safety" icon={AlertTriangle}>
              <ul className="space-y-2">
                {safetyRules.map((rule) => (
                  <li key={rule} className="flex gap-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                    <span>{rule}</span>
                  </li>
                ))}
              </ul>
              <Link href="/safety" className="block text-brand-green underline">
                Open the Safety Centre
              </Link>
            </TrustCard>

            <TrustCard title="Payments and refunds" icon={CreditCard}>
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
            </TrustCard>

            <TrustCard title="Accountability channels" icon={LifeBuoy}>
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
            </TrustCard>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
