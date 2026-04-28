import Link from "next/link";
import { FileText, Mail, Scale } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getConfiguredLegalIdentityRows, getTrustPublicConfig } from "@/lib/trust-public-config";

export const metadata = {
  title: "PAIA Manual",
  description:
    "VerifyMzansi PAIA and POPIA request process, Information Officer contact details, and escalation path.",
};

export default function PaiaManualPage() {
  const trustConfig = getTrustPublicConfig();
  const legalRows = getConfiguredLegalIdentityRows(trustConfig);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main id="main-content" className="flex-1">
        <div className="container-page space-y-5 py-4">
          <PageHeader
            title="PAIA Manual"
            description="How to request records or exercise POPIA data-subject rights with VerifyMzansi."
            breadcrumbs={[{ label: "PAIA Manual" }]}
          />

          <section className="rounded-lg border border-brand-green/20 bg-brand-green/5 p-4 text-sm text-muted-foreground">
            <p>
              This page is the public PAIA/POPIA request guide for VERIFYMZANSI (PTY) LTD, trading
              as VerifyMzansi. A downloadable manual and request template will be published here
              when finalised.
            </p>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-4 w-4 text-brand-green" />
                  Legal Identity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-2 text-sm">
                  {legalRows.map((row) => (
                    <div key={row.label} className="rounded-md border bg-background px-3 py-2">
                      <dt className="text-xs font-medium text-foreground">{row.label}</dt>
                      <dd className="mt-1 break-words text-muted-foreground">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Mail className="h-4 w-4 text-brand-green" />
                  Requests
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Send PAIA record requests and POPIA data-subject requests to{" "}
                  <a
                    href={`mailto:${trustConfig.informationOfficerEmail}`}
                    className="text-brand-green underline"
                  >
                    {trustConfig.informationOfficerEmail}
                  </a>
                  .
                </p>
                <p>
                  Signed-in users can submit access, correction, deletion, objection, export, and
                  recipient-information requests through the data-subject request form.
                </p>
                <Link href="/dsar" className="inline-flex text-brand-green underline">
                  Open data-subject request form
                </Link>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Scale className="h-4 w-4 text-brand-green" />
                Response and Escalation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                Privacy requests are acknowledged within 2 business days where possible. POPIA data
                requests are handled within the timelines required by South African law.
              </p>
              <p>
                If your privacy complaint is not resolved through VerifyMzansi first, you may
                escalate to the Information Regulator South Africa.
              </p>
              <p>
                Information Officer registration status: not publicly displayed yet. This page will
                be updated when the status or certificate is available for publication.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>

      <Footer />
    </div>
  );
}
