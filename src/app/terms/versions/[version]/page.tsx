import { notFound } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { LegalDocument, LegalBlocks } from "@/components/safety/legal-document";
import { getPublishedPostingTerms } from "@/lib/legal/published-posting-terms";

export const metadata = { title: "Versioned posting terms" };

export default async function PostingTermsVersionPage({
  params,
}: {
  params: Promise<{ version: string }>;
}) {
  const { version } = await params;
  const document = getPublishedPostingTerms(version);
  if (!document) notFound();
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main-content" className="flex-1">
        <LegalDocument
          title={document.title}
          meta={`Posting terms · ${document.version}`}
          breadcrumbs={[{ label: "Terms of Service", href: "/terms" }, { label: document.version }]}
          sections={document.sections.map((section) => ({
            id: section.id,
            title: section.title,
            navLabel: section.navLabel,
            content: <LegalBlocks paragraphs={section.content} />,
          }))}
        />
        <nav
          aria-label="Related policies"
          className="container-page flex flex-wrap gap-6 pb-10 text-sm underline"
        >
          <Link href={document.privacy_path}>Privacy Policy</Link>
          <Link href={document.company_details_path}>Company details and legal contact</Link>
        </nav>
      </main>
      <Footer />
    </div>
  );
}
