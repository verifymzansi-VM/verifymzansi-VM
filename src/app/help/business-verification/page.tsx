import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Eye, IdCard } from "lucide-react";

import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { InfoHero, SectionHeading } from "@/components/safety/info-hero";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Business verification",
  description:
    "What the ID Reviewed, CIPC Registered and Seen by VerifyMzansi stickers mean, and how to get them.",
};

const STICKERS = [
  {
    icon: IdCard,
    name: "ID reviewed",
    means: "Our team reviewed the ID and selfie of the person who runs the profile.",
    not: "It doesn't check the business itself.",
  },
  {
    icon: Building2,
    name: "CIPC registered",
    means:
      "The company is registered with CIPC and In Business, and the person who runs the profile is a director or a confirmed company representative. We check CIPC's own records, not just the document you send.",
    not: "It is not a tax, B-BBEE or credit check.",
  },
  {
    icon: Eye,
    name: "Seen by VerifyMzansi",
    means:
      "We saw the business operating — in person or on a live video call — including its premises, stock or work. Open to every business, registered or not.",
    not: "It is not a quality rating or a guarantee.",
  },
];

const DOCUMENTS = [
  {
    name: "Free disclosure",
    how: "CIPC eServices or BizPortal → search your company → free disclosure. Costs nothing.",
  },
  {
    name: "Disclosure Certificate",
    how: "CIPC eServices → disclosure for official use (R30). Shows current directors and history.",
  },
  {
    name: "Registration Certificate (CoR14.3)",
    how: "Sent to you when the company was registered. Also downloadable from BizPortal.",
  },
];

const NEEDS_INFO = [
  {
    title: "We couldn't find you as a director",
    fix: "If you are a director, check that your verified ID is the one on CIPC's records. If you are a manager or other staff member, choose the company representative option.",
  },
  {
    title: "The document looked edited",
    fix: "Download a fresh PDF from CIPC and send it as-is, without opening it in another app first.",
  },
  {
    title: "The status isn't In Business",
    fix: "Bring your annual returns up to date with CIPC, then send a new disclosure.",
  },
  {
    title: "We couldn't read the file",
    fix: "Send the PDF you downloaded from CIPC rather than a photo or scan.",
  },
];

/** Annotated layout of a CIPC disclosure. Every value is fictional. */
function ExampleDocument() {
  const callout =
    "ml-2 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-gold-400 text-[11px] font-bold text-brand-green-950";
  return (
    <figure className="surface-card overflow-hidden p-0">
      <div className="space-y-3 bg-white p-4 font-mono text-[11px] leading-5 text-neutral-800 sm:p-6 sm:text-xs">
        <p className="text-neutral-500">
          Certificate issued by the Commissioner of Companies &amp; Intellectual Property Commission
          on Monday, October 5, 2026
        </p>
        <p className="flex items-center font-bold">
          Disclosure Certificate: Companies and Close Corporations<span className={callout}>1</span>
        </p>
        <div className="grid grid-cols-[9rem,1fr] gap-x-3">
          <span>Registration Number</span>
          <span className="flex items-center">
            2020 / 123456 / 07<span className={callout}>2</span>
          </span>
          <span>Enterprise Name</span>
          <span>EXAMPLE TRADING (PTY) LTD</span>
          <span>Enterprise Status</span>
          <span className="flex items-center">
            In Business<span className={callout}>3</span>
          </span>
        </div>
        <div>
          <p className="flex items-center font-bold">
            ADDRESS OF REGISTERED OFFICE<span className={callout}>4</span>
          </p>
          <p>12 MAIN ROAD · KWADLANGEZWA · EMPANGENI · KWA-ZULU NATAL · 3886</p>
        </div>
        <div>
          <p className="flex items-center font-bold">
            ACTIVE MEMBERS / DIRECTORS<span className={callout}>5</span>
          </p>
          <p>DLAMINI, THANDO · Director · 0000000000000</p>
        </div>
      </div>
      <figcaption className="space-y-1 border-t border-border p-4 text-sm">
        <p>
          <strong>1</strong> Document type · <strong>2</strong> registration number ·{" "}
          <strong>3</strong> must be In Business · <strong>4</strong> becomes the registered office
          on your profile · <strong>5</strong> your verified ID must match a director, unless you
          use the company representative route.
        </p>
        <p className="text-muted-foreground">
          Example only — the company and ID number are fictional.
        </p>
      </figcaption>
    </figure>
  );
}

export default function BusinessVerificationHelpPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main-content" className="flex-1">
        <InfoHero
          title="Business verification"
          description="Three stickers that show buyers what we've checked."
          breadcrumbs={[
            { label: "Help", href: "/help/verification" },
            { label: "Business verification" },
          ]}
          actions={
            <Button asChild variant="trust-verified" size="lg">
              <Link href="/dashboard/listings?area=MZANSI_BUSINESS">Verify my business</Link>
            </Button>
          }
        />

        <div className="container-page max-w-4xl space-y-14 py-10 sm:py-14">
          <section aria-labelledby="stickers-title">
            <SectionHeading
              id="stickers-title"
              title="The three stickers"
              lede="Each one is checked by our team."
            />
            <ul className="mt-6 grid gap-3 sm:grid-cols-3">
              {STICKERS.map((s) => (
                <li key={s.name} className="surface-card space-y-2 p-5">
                  <span className="icon-tile area-market-tile">
                    <s.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="font-body text-base font-semibold">{s.name}</h3>
                  <p className="text-sm leading-6 text-muted-foreground">{s.means}</p>
                  <p className="text-xs text-muted-foreground">{s.not}</p>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="documents-title" id="documents">
            <SectionHeading
              id="documents-title"
              title="CIPC documents we accept"
              lede="Any one of these. Send the PDF exactly as CIPC gave it to you."
            />
            <ul className="mt-6 grid gap-3 sm:grid-cols-3">
              {DOCUMENTS.map((d) => (
                <li key={d.name} className="surface-card p-5">
                  <h3 className="font-body text-base font-semibold">{d.name}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{d.how}</p>
                </li>
              ))}
            </ul>
            <div className="mt-6">
              <ExampleDocument />
            </div>
          </section>

          <section aria-labelledby="representative-title">
            <SectionHeading
              id="representative-title"
              title="Not a director?"
              lede="Managers and other staff can verify a company too."
            />
            <ol className="mt-6 list-decimal space-y-2 pl-5 text-sm leading-6">
              <li>Verify your own ID.</li>
              <li>Send a CIPC document and tick &ldquo;I represent the company&rdquo;.</li>
              <li>We send a code to your work email on the company&apos;s own website domain.</li>
              <li>
                We phone the company on a number we find ourselves — never one you give us — to
                confirm you work there and may represent it online.
              </li>
            </ol>
          </section>

          <section aria-labelledby="seen-title">
            <SectionHeading
              id="seen-title"
              title="Getting seen"
              lede="A short live video call, or a visit where we can."
            />
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Have your premises, stock or recent work ready to show, and your ID card — the
              verifier checks it matches the name on your reviewed ID. Calls are not recorded.
              Photos and screenshots are taken only with your consent, stay private, and are deleted
              30 days after the decision. Your profile shows only the city we visited.
            </p>
          </section>

          <section aria-labelledby="needs-info-title">
            <SectionHeading
              id="needs-info-title"
              title="If we ask for more"
              lede="You'll get a message on your Verify page. Reply there or send a new document."
            />
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {NEEDS_INFO.map((n) => (
                <li key={n.title} className="surface-card p-5">
                  <h3 className="font-body text-base font-semibold">{n.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{n.fix}</p>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="privacy-title">
            <SectionHeading
              id="privacy-title"
              title="Your privacy"
              lede="We keep only what we need."
            />
            <ul className="mt-4 space-y-2 text-sm leading-6 text-muted-foreground">
              <li>
                Documents are encrypted and seen only by our verification team; every view is
                logged.
              </li>
              <li>
                Your document is kept encrypted until 30 days after a decision, then deleted. The ID
                numbers we read from it are kept only as a one-way code used for matching.
              </li>
              <li>
                Your profile shows the suburb, city and province of your registered office. The
                street address appears only if you choose to show it.
              </li>
              <li>Stickers last 12 months. Renewal is one tap.</li>
            </ul>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
