import Link from "next/link";
import { Mail } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { LegalBlocks, LegalDocument, type LegalSection } from "@/components/safety/legal-document";
import { getConfiguredLegalIdentityRows, getTrustPublicConfig } from "@/lib/trust-public-config";

export const metadata = {
  title: "PAIA Manual",
  description:
    "VerifyMzansi's PAIA manual (section 51): company details, records we hold, how we process personal information, and how to request access to records.",
};

const REQUEST_STEPS = [
  { title: "Send your request", body: "By email, or the signed-in form." },
  { title: "We confirm who you are", body: "We may ask for proof of identity." },
  { title: "We decide within 30 days", body: "We may extend once by up to 30 days, in writing." },
] as const;

const MANUAL_TEXT = [
  {
    id: "purpose",
    navLabel: "About this manual",
    title: "About this manual",
    content: [
      "This is the manual of VERIFYMZANSI (PTY) LTD, a private body, under section 51 of the Promotion of Access to Information Act 2 of 2000 (PAIA), as amended by the Protection of Personal Information Act 4 of 2013 (POPIA).",
      "It explains what records we hold, which records are available without a request, how we process personal information, and how to ask for access to a record.",
      "The manual is published on this page and is available for inspection at our registered address, free of charge. You may print it or save it as a PDF from your browser.",
    ],
  },
  {
    id: "regulator-guide",
    navLabel: "Information Regulator guide",
    title: "Guide on how to use PAIA",
    content: [
      "The Information Regulator publishes a guide, in each official language, on how to use PAIA and POPIA (section 10 of PAIA). You can get it from the Information Regulator's website, inforegulator.org.za, or by email to enquiries@inforegulator.org.za. A copy is also available from our Information Officer on request.",
    ],
  },
  {
    id: "automatic-records",
    navLabel: "Records without a request",
    title: "Records available without a request",
    content: [
      "The following are freely available on verifymzansi.com, without a PAIA request:",
      "• Terms of Service, Privacy Policy and this manual",
      "• Trust & Safety, Safety Centre and help pages, including what our verification checks mean",
      "• Plan prices and billing rules on the pricing page",
      "• Public posts, business profiles and the stickers they hold",
      "No notice has been published under section 52 of PAIA.",
    ],
  },
  {
    id: "legislation-records",
    navLabel: "Records under other laws",
    title: "Records kept under other legislation",
    content: [
      "Where they apply to us, we keep records under these laws, among others:",
      "• Companies Act 71 of 2008",
      "• Income Tax Act 58 of 1962, Value-Added Tax Act 89 of 1991 and Tax Administration Act 28 of 2011",
      "• Basic Conditions of Employment Act 75 of 1997, Labour Relations Act 66 of 1995, Unemployment Insurance Act 63 of 2001 and Compensation for Occupational Injuries and Diseases Act 130 of 1993",
      "• Consumer Protection Act 68 of 2008",
      "• Electronic Communications and Transactions Act 25 of 2002",
      "• Protection of Personal Information Act 4 of 2013 and Promotion of Access to Information Act 2 of 2000",
    ],
  },
  {
    id: "record-categories",
    navLabel: "Records we hold",
    title: "Subjects and categories of records",
    content: [
      "• Company: incorporation documents, CIPC records, share register, minutes and resolutions",
      "• Finance and tax: accounting records, invoices, payment records from Ozow, tax returns and correspondence with SARS",
      "• People who work with us: contracts, payroll and statutory records, where applicable",
      "• Members: account details, verification records (phone confirmation, ID and selfie review decisions), posts, media, enquiries, plans bought, reports, moderation and appeal records",
      "• Businesses: business profiles, CIPC registered and Seen by VerifyMzansi verification cases, decisions and correspondence",
      "• Suppliers and partners: contracts, programme partner agreements and correspondence",
      "• Technology and security: system, audit and access logs, and incident records",
    ],
  },
  {
    id: "popia-processing",
    navLabel: "Personal information",
    title: "How we process personal information",
    content: [
      "Purposes: to run accounts and verification, publish posts and pass on enquiries, take payment for plans, prevent fraud and abuse, provide support, keep legal, tax and accounting records, and keep the platform secure.",
      "Categories of data subjects and their information:",
      "• Members: name, email, phone, SA ID or passport number and images, selfie, province and city, posts, media, enquiries, payment references and device data",
      "• Business owners and representatives: the above, plus company details, director or representative status and verification notes or visit photos",
      "• Visitors: device and browser data, a random browser identifier and a hashed network address used for view counting",
      "• People who send enquiries: name, contact details and message",
      "• Employees, contractors, suppliers and partners: contact, contract and payment details",
      "Recipients: our own staff on a need-to-know basis, and operators who process information for us: Supabase (database, sign-in and file storage), Cloudflare (hosting, security and bot protection), Resend (email), Africa's Talking (SMS codes), Sentry (error monitoring) and Ozow (payments). We also disclose information where the law requires it.",
      "Cross-border transfers: some of these operators store or process information outside South Africa. We only use operators bound by agreements that give a level of protection substantially similar to POPIA, as section 72 of POPIA requires.",
      "Security: encryption in transit, encryption of ID numbers at rest, restricted and logged access to verification files, private storage that is never public, deletion schedules for ID, selfie and business verification files, and audit logs.",
      "Retention periods are set out in our Privacy Policy.",
    ],
  },
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
    ...MANUAL_TEXT.map((section) => ({
      id: section.id,
      navLabel: section.navLabel,
      title: section.title,
      content: <LegalBlocks paragraphs={section.content} />,
    })),
    {
      id: "requests",
      navLabel: "How to make a request",
      title: "Requests",
      content: (
        <div className="max-w-prose space-y-5 text-[15px] leading-7 text-foreground/80">
          <p>
            Use Form 2 (Request for Access to Record), which you can download from the Information
            Regulator&apos;s website, and send it to{" "}
            <a
              href={`mailto:${trustConfig.informationOfficerEmail}`}
              className="font-semibold text-brand-green-700 underline underline-offset-4 hover:text-brand-green-800 dark:text-brand-green-300 dark:hover:text-brand-green-200"
            >
              {trustConfig.informationOfficerEmail}
            </a>
            . Give enough detail for us to identify the record, say how you want access (copy,
            inspection or electronic), and, if you ask on behalf of someone else, include proof of
            your authority. To exercise a PAIA right that protects you, explain which right and why
            the record is needed.
          </p>
          <p>
            For your own personal information, signed-in members can also use the data-subject
            request form for access, correction, deletion, objection, export and
            recipient-information requests.
          </p>
          <p>
            Fees: requests for your own personal information are free. For other records, the
            request and access fees prescribed in the PAIA Regulations apply. We will tell you the
            amount in writing before any work starts, and you may ask the Information Regulator to
            review a fee.
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
            We acknowledge requests within 2 business days where possible, and decide within 30 days
            (section 56 of PAIA). We may extend this once by up to 30 days, and will tell you why in
            writing (section 57). If we do not decide in time, the request is treated as refused
            (section 58).
          </p>
          <p>
            We may refuse access only on the grounds in Chapter 4 of Part 3 of PAIA, for example to
            protect another person&apos;s privacy, commercial information, confidential information,
            safety or legally privileged records. If we refuse, we give reasons.
          </p>
          <p>
            If you are unhappy with our decision, you may complain to the Information Regulator
            South Africa within 180 days (section 77A), or apply to court (section 78).
          </p>
          <p className="rounded-2xl bg-muted/70 px-4 py-3 text-sm leading-6 text-muted-foreground">
            Our Information Officer is registered with the Information Regulator
            {trustConfig.informationOfficerRegistration
              ? ` (registration number ${trustConfig.informationOfficerRegistration})`
              : ""}
            .
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
          meta="Section 51 manual · Updated October 2026"
          description="Our records, how we process personal information, and how to request access."
          breadcrumbs={[{ label: "PAIA Manual" }]}
          summary={
            <p>
              This is the PAIA manual of VERIFYMZANSI (PTY) LTD, trading as VerifyMzansi. To ask for
              a record, complete Form 2 from the Information Regulator and email it to our
              Information Officer.
            </p>
          }
          sections={sections}
        />
      </main>

      <Footer />
    </div>
  );
}
