import { buildTermsTextSections } from "@/lib/legal/terms-text";
import { readCurrentPublishedPostingTerms } from "@/lib/legal/current-posting-terms";
import Link from "next/link";
import { Mail } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { LegalBlocks, LegalDocument, type LegalSection } from "@/components/safety/legal-document";
import { getConfiguredLegalIdentityRows, getTrustPublicConfig } from "@/lib/trust-public-config";

export const metadata = {
  title: "Terms of Service",
  description:
    "VerifyMzansi terms of service: our role, what our checks mean, payments, refunds and posting rules for marketplace listings, businesses, tourism and events in South Africa.",
};

export default async function TermsPage() {
  const trustConfig = getTrustPublicConfig();
  const legalRows = getConfiguredLegalIdentityRows(trustConfig);
  let published: Awaited<ReturnType<typeof readCurrentPublishedPostingTerms>> = null;
  if (process.env.FOUNDATION_SUPABASE_URL) {
    try {
      published = await readCurrentPublishedPostingTerms();
    } catch {
      /* Fail closed below. */
    }
    if (!published)
      return (
        <div className="flex min-h-screen flex-col">
          <Header />
          <main id="main-content" className="container-page flex-1 py-12">
            <h1 className="text-2xl font-semibold">Terms temporarily unavailable</h1>
            <p className="mt-3">Please try again shortly.</p>
          </main>
          <Footer />
        </div>
      );
  }
  const textSections = published?.sections ?? buildTermsTextSections(trustConfig);

  const sections: LegalSection[] = [
    ...textSections.map((section) => ({
      id: section.id,
      navLabel: section.navLabel,
      title: section.title,
      content: <LegalBlocks paragraphs={section.content} />,
    })),
    {
      id: "about-us",
      navLabel: "About us",
      title: "Who we are",
      content: (
        <dl className="grid max-w-prose gap-x-6 gap-y-2 text-[15px] leading-7 sm:grid-cols-[auto_1fr]">
          {legalRows.map((row) => (
            <div key={row.label} className="contents">
              <dt className="font-semibold text-foreground">{row.label}</dt>
              <dd className="text-foreground/80">{row.value}</dd>
            </div>
          ))}
        </dl>
      ),
    },
    {
      id: "privacy-contact",
      navLabel: "Privacy & contact",
      title: "Privacy & contact",
      content: (
        <div className="max-w-prose space-y-4">
          <p className="text-[15px] leading-7 text-foreground/80">
            Your use of VerifyMzansi is also governed by our Privacy Policy.
          </p>
          <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
            <Link
              href="/privacy"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-input bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              View Privacy Policy
            </Link>
            <a
              href="mailto:legal@verifymzansi.com"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-green-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:bg-brand-green-500 dark:text-brand-green-950 dark:hover:bg-brand-green-400"
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
              legal@verifymzansi.com
            </a>
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main id="main-content" className="flex-1">
        <LegalDocument
          title="Terms of Service"
          meta={published ? `Posting terms · ${published.version}` : "Updated October 2026"}
          description="Governed by South African law."
          breadcrumbs={[{ label: "Terms of Service" }]}
          sections={sections}
        />
      </main>

      <Footer />
    </div>
  );
}
