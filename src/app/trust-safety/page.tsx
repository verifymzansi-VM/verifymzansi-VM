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
    meaning:
      "The person posting submitted an ID number, ID evidence, and selfie for platform review.",
  },
  {
    name: "Location verified",
    meaning: "The user saved a South African location and may have matched it with device GPS.",
  },
  {
    name: "Official representative reviewed",
    meaning:
      "VerifyMzansi does not verify that a business itself is official. We review the person posting on behalf of that business using their phone number, ID evidence, and selfie.",
  },
  {
    name: "Payment verified",
    meaning: "A paid feature was processed through the platform's payment flow.",
  },
] as const;

const safetyRules = [
  "Never pay deposits before seeing goods or confirming the seller is legitimate.",
  "Meet in safe public places and tell someone where you are going.",
  "Avoid courier, EFT, e-wallet, and OTP pressure tactics.",
  "Keep records of chats, payment references, listings, and profile links.",
  "Report suspicious listings, accounts, representatives, or business profiles before continuing a deal.",
] as const;

const dataPractices = [
  "ID numbers, document images, selfies, phone numbers, and location data are collected only for verification, fraud prevention, safety, and legal compliance.",
  "Verification files are encrypted in transit and stored in restricted verification storage; internal access is limited to authorised operational reviewers.",
  "Third-party KYC, SMS, payment, storage, email, security, and infrastructure providers may process data where needed to deliver the service.",
  "Users can request access, correction, deletion, or objection through the POPIA data-rights process.",
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
            description="Clear answers about who VerifyMzansi is, how person-level verification works, and what users should still do to stay safe."
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
                  A verified badge means a person or account completed specific platform checks. It
                  does not mean VerifyMzansi has verified the business itself, nor that every
                  seller, buyer, product, job, rental, event, or business profile is guaranteed
                  safe, lawful, available, or fairly priced.
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
                VerifyMzansi verifies people who post or manage content on the platform. Business
                profiles are content records and should not be treated as an official endorsement of
                the business unless the page clearly says the official representative was reviewed.
              </p>
              <p>
                You can independently verify our registration on CIPC using registration number{" "}
                {trustConfig.cipcNumber}. Use the official CIPC company lookup or registration
                certificate process before relying on company details for high-value transactions.
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
              <Link href="/privacy" className="inline-flex text-brand-green underline">
                Read the Privacy Policy
              </Link>
              <Link href="/dsar" className="inline-flex text-brand-green underline">
                Open the POPIA data-subject request form
              </Link>
            </TrustCard>
          </div>

          <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <TrustCard title="PAIA and POPIA process" icon={Scale}>
              <p>
                Users can request access, correction, deletion, objection, recipient information, or
                account-data export through the signed-in data-rights form or POPIA contact.
              </p>
              <p>
                The PAIA manual explains record requests, data-subject requests, Information Officer
                status, and escalation routes. Downloadable request templates will be added when
                finalised.
              </p>
              <Link href="/paia" className="inline-flex text-brand-green underline">
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
              <Link href="/safety" className="inline-flex text-brand-green underline">
                Open the Safety Centre
              </Link>
            </TrustCard>

            <TrustCard title="Payments and refunds" icon={CreditCard}>
              <p>
                Paid visibility features are processed through secure hosted checkout in South
                African rand. The checkout should show VerifyMzansi
                {trustConfig.ozowMerchantName ? ` or ${trustConfig.ozowMerchantName}` : ""} as the
                expected merchant name.
              </p>
              <p>
                Listings remain subject to moderation. If paid content is rejected, cancelled, or
                disputed, refund handling follows the Terms of Service, the Consumer Protection Act,
                and the payment provider record.
              </p>
              {trustConfig.vatStatus && <p>VAT status: {trustConfig.vatStatus}</p>}
            </TrustCard>

            <TrustCard title="Accountability channels" icon={LifeBuoy}>
              <p>
                Suspicious listings, fraud reports, data-rights requests, verification appeals, and
                security concerns should be sent through the correct support channel.
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
