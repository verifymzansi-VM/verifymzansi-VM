import Link from "next/link";
import { Mail } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { LegalDocument, type LegalSection } from "@/components/safety/legal-document";
import { getConfiguredLegalIdentityRows, getTrustPublicConfig } from "@/lib/trust-public-config";

export const metadata = {
  title: "PAIA Manual",
  description:
    "VerifyMzansi PAIA and POPIA request process, Information Officer contact details, and escalation path.",
};

const REQUEST_STEPS = [
  { title: "Send your request", body: "By email, or the signed-in form." },
  { title: "We confirm who you are", body: "We may ask for proof of identity." },
  { title: "We respond", body: "Within the timelines POPIA and PAIA require." },
] as const;

export default function PaiaManualPage() {
  const trustConfig = getTrustPublicConfig();
  const legalRows = getConfiguredLegalIdentityRows(trustConfig);

  const sections: LegalSection[] = [
    {
      id: "legal-identity",
      navLabel: "Legal identity",
      title: "Legal identity",
      content: (
        <dl className="grid gap-3 sm:grid-cols-2">
          {legalRows.map((row) => (
            <div key={row.label} className="surface-card px-4 py-3">
              <dt className="text-xs font-semibold text-muted-foreground">{row.label}</dt>
              <dd className="mt-1 break-words text-sm font-medium text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
      ),
    },
    {
      id: "requests",
      navLabel: "How to make a request",
      title: "Requests",
      content: (
        <div className="max-w-prose space-y-5 text-[15px] leading-7 text-foreground/80">
          <p>
            Send PAIA record requests and POPIA data-subject requests to{" "}
            <a
              href={`mailto:${trustConfig.informationOfficerEmail}`}
              className="font-semibold text-brand-green-700 underline underline-offset-4 hover:text-brand-green-800 dark:text-brand-green-300 dark:hover:text-brand-green-200"
            >
              {trustConfig.informationOfficerEmail}
            </a>
            . Signed-in users can submit access, correction, deletion, objection, export, and
            recipient-information requests through the data-subject request form.
          </p>
          <ol className="space-y-3">
            {REQUEST_STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-3.5">
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-green/10 text-sm font-bold text-brand-green-700 dark:bg-brand-green/15 dark:text-brand-green-300"
                >
                  {index + 1}
                </span>
                <div>
                  <p className="font-semibold text-foreground">{step.title}</p>
                  <p className="text-sm leading-6 text-muted-foreground">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
            <Link
              href="/dsar"
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-green-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:bg-brand-green-500 dark:text-brand-green-950 dark:hover:bg-brand-green-400"
            >
              Open data-subject request form
            </Link>
            <a
              href={`mailto:${trustConfig.informationOfficerEmail}`}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-input bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
              Email the Information Officer
            </a>
          </div>
        </div>
      ),
    },
    {
      id: "escalation",
      navLabel: "Response & escalation",
      title: "Response and escalation",
      content: (
        <div className="max-w-prose space-y-4 text-[15px] leading-7 text-foreground/80">
          <p>
            Privacy requests are acknowledged within 2 business days where possible. POPIA data
            requests are handled within the timelines required by South African law.
          </p>
          <p>
            If your privacy complaint is not resolved through VerifyMzansi first, you may escalate
            to the Information Regulator South Africa.
          </p>
          <p className="rounded-2xl bg-muted/70 px-4 py-3 text-sm leading-6 text-muted-foreground">
            Information Officer registration status: not publicly displayed yet. This page will be
            updated when the status or certificate is available for publication.
          </p>
        </div>
      ),
    },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main id="main-content" className="flex-1">
        <LegalDocument
          title="PAIA Manual"
          meta="Public request guide"
          description="How to request records or exercise POPIA data-subject rights with VerifyMzansi."
          breadcrumbs={[{ label: "PAIA Manual" }]}
          summary={
            <p>
              This page is the public PAIA/POPIA request guide for VERIFYMZANSI (PTY) LTD, trading
              as VerifyMzansi. A downloadable manual and request template will be published here
              when finalised.
            </p>
          }
          sections={sections}
        />
      </main>

      <Footer />
    </div>
  );
}
