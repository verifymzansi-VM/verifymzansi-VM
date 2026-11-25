import Link from "next/link";
import { Mail } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { LegalBlocks, LegalDocument, type LegalSection } from "@/components/safety/legal-document";
import { LEGAL_CONTACT_EMAIL } from "@/lib/contact-email";
import { COMPANY_LEGAL_NAME, COMPANY_REGISTRATION_NUMBER } from "@/lib/legal/company-identity";
import { getTrustPublicConfig } from "@/lib/trust-public-config";

export const metadata = {
  title: "Privacy Policy",
  alternates: { canonical: "/privacy" },
  description:
    "How VerifyMzansi collects, uses, and protects your personal information. POPIA-compliant data practices.",
};

export default function PrivacyPolicyPage() {
  const trustConfig = getTrustPublicConfig();
  const evidenceRetention =
    "ID photos are deleted 30 days after the decision on your check, and Didit deletes its copy within 30 days too. The selfie and encrypted ID number of an accepted check are kept while your account is open and deleted 90 days after you close it. The names on your ID, your verified phone numbers and a one-way code made from your ID number are kept for 5 years after your account closes, so a banned identity cannot sign up again. If your ID number is banned, everything is kept for 5 years from the ban. A check that is not accepted keeps only the one-way code: its photos are deleted 5 days after the decision (your time to ask a person to look again), then its ID number and names. Unfinished uploads are deleted after 90 days. An open report on your account or posts, a fraud hold or a legal hold pauses deletion.";
  const dataHandlingRows = [
    {
      dataType: "Introductory-offer identity token",
      purpose: "Prevent repeated trial claims across accounts",
      recipients: "Restricted platform fraud-prevention workflows; never public",
      retention:
        "A keyed identity token is kept while your account is open and for 3 years after you close it, so the free post cannot be claimed twice",
      deletion: "Request a review through the data-rights workflow",
    },
    {
      dataType: "ID number",
      purpose: "Identity verification, duplicate-account checks, fraud prevention",
      recipients: "Our verification staff, and Didit when your check runs through it",
      retention: evidenceRetention,
      deletion: "Deleted with the case evidence; open fraud or legal holds pause deletion",
    },
    {
      dataType: "ID document image",
      purpose: "Evidence review and identity matching",
      recipients: "Our verification staff, and Didit when your check runs through it",
      retention: evidenceRetention,
      deletion: "Reviewed against fraud, dispute, accounting, and legal-hold obligations",
    },
    {
      dataType: "Selfie image",
      purpose:
        "Taken live with your camera on our page (photos from your gallery or files are refused) and compared with your ID photo by our staff, or by Didit when your check runs through it",
      recipients: "Our verification staff, and Didit when your check runs through it",
      retention: evidenceRetention,
      deletion: "Close your account (deleted 90 days later) or ask through the data-rights form",
    },
    {
      dataType: "Phone number",
      purpose: "OTP checks, account recovery, safety contact, and posting accountability",
      recipients: "Africa's Talking (SMS codes), internal platform systems, and support reviewers",
      retention:
        "Kept while your account is open. A number you remove is deleted 30 days later. When an account with a reviewed ID closes, its verified numbers are kept for 5 years with the identity record. If an account is banned, the numbers it verified are kept for 5 years (or until the ban is lifted) so they cannot be used to verify again",
      deletion: "Update or delete through account/data-rights workflow where legally allowed",
    },
    {
      dataType: "Location",
      purpose: "The province and city you give us, shown on your profile and posts",
      recipients: "Internal platform systems and infrastructure providers",
      retention:
        "Your home area is deleted 30 days after you close your account; a post's area goes with the post",
      deletion: "Remove from profile/listing or request correction/deletion",
    },
    {
      dataType: "Business verification files",
      purpose:
        "CIPC registered and Seen by VerifyMzansi checks: CIPC documents, call notes and visit photos",
      recipients: "Restricted business-verification reviewers; never public",
      retention:
        "Deleted 30 days after the decision. The sticker, its date and the town visited stay on the profile for 12 months",
      deletion: "Request through the data-rights workflow; calls are not recorded",
    },
    {
      dataType: "Payment data",
      purpose: "Checkout, slots and packages, accounting, refunds, and dispute handling",
      recipients: "Ozow (payment provider), our accounting records, and platform support",
      retention:
        "Kept for 5 years after the end of the tax year (1 March to the end of February) in which the payment was made, as tax law requires",
      deletion: "Handled under provider rules and platform legal/accounting obligations",
    },
  ] as const;
  const textSections = [
    {
      id: "who-we-are",
      navLabel: "Who we are",
      title: "Who we are",
      content: [
        `VerifyMzansi is run by ${trustConfig.legalName ?? COMPANY_LEGAL_NAME}, registration number ${trustConfig.cipcNumber ?? COMPANY_REGISTRATION_NUMBER}, a private company registered in South Africa. It is the responsible party for your personal information under POPIA.`,
        `Our registered address is the one recorded at CIPC. Legal notices go to ${LEGAL_CONTACT_EMAIL}. For anything about your personal information, contact our Information Officer (below).`,
      ],
    },
    {
      id: "information-we-collect",
      navLabel: "What we collect",
      title: "Information we collect",
      content: [
        "We collect information you provide directly:",
        "• Account information (name, email, phone number)",
        "• Verification documents (ID number, selfie, location)",
        "• Listing content (titles, descriptions, images, pricing)",
        "• Communication records and payment information handled by Ozow and payment providers",
        "We also collect device/browser info, IP address, and usage data automatically.",
        "Some information comes from others: Google (only if you sign in with Google, which shares your name and email with us), Didit (the result of your ID check), Ozow (whether a payment went through), CIPC's public register (business checks), and people who send you enquiries or report a post.",
        "Giving us information is voluntary, but some of it is needed. You can browse without an account. To post, you must confirm your email and phone and have your ID reviewed; without them you cannot post. Tax law (the Tax Administration Act) requires us to keep payment and invoice records.",
        "Error monitoring: when something breaks, Sentry records technical details of the error. We do not record replays of your screen.",
        "Showroom area: when you open a page with a showroom, we estimate your province and city from your internet connection so we can show posts near you first. It is used only for that page and is not stored.",
      ],
    },
    {
      id: "cookies",
      navLabel: "Cookies",
      title: "Cookies and browser storage",
      content: [
        "• Needed to run the site: sign-in cookies that keep you signed in, a form-protection cookie (vm_csrf, 12 hours), and short-lived cookies for phone codes, password recovery and continuing your ID check on your phone. Cloudflare may add its own security cookies to stop bots.",
        "• View and like counting: after a Cloudflare Turnstile check, your browser gets a random identifier in a cookie that we sign (vmz_viewer), kept for a year. For views we store only a one-way hash of it mixed with a code that changes every day; both are deleted within 3 days, so a post counts you once a day but we cannot follow you from day to day. A post appearing at the front of a showroom stores the same kind of daily one-way hash, so it counts once a day for you. A like made while signed out stores a keyed one-way hash of the identifier for as long as the post is up, so you can undo it. A like made while signed in is stored with your account, appears in your data export and is deleted with your account. When you are signed in we use your account to leave out views of your own posts (and all views by our staff); it is not stored with a view. We do not store your network address for counting. Post owners only see totals.",
        "• Partner and campaign links: if you arrive through a partner's or campaign link, a cookie (vm_acq, 30 days) remembers the code, the page you landed on and the site that sent you, so the partner can be credited if you sign up.",
        "• Browser storage: your browser notes the posts you viewed in the last 30 minutes and the posts you liked, so they count once, and keeps settings such as your theme and unsent post drafts. It stays on your device.",
      ],
    },
    {
      id: "verification-data",
      navLabel: "Verification data",
      title: "How verification data is used",
      content: [
        "ID numbers, ID document images, selfies, phone numbers, and location data are used to run verification checks, reduce fraud, review account safety, and support legal compliance.",
        "We check IDs in one of two ways, which we set: our own staff review them, or Didit, our independent verification partner, checks your ID and face. On the ID step we tell you when Didit is used and ask for your consent first. Didit's result may be applied automatically; if it declines you, you can ask a person to look again within 5 days. We do not check IDs against Home Affairs or run criminal or credit checks.",
        "Businesses can also ask for two optional stickers. CIPC registered: we check CIPC's records that the company is In Business and that the person running the profile is a director or confirmed representative. Seen by VerifyMzansi: we see the business operating, in person or on a live video call. Without these stickers, business-profile signals refer only to the person running the profile.",
        "Verification does not guarantee that a person, business profile, product, rental, event, job, or transaction is safe. It only means specific platform checks were completed or reviewed.",
      ],
    },
    {
      id: "public-information",
      navLabel: "What others can see",
      title: "What other people can see",
      content: [
        "Anyone can browse VerifyMzansi without signing in. Signing in is only needed to post.",
        "• Your public name is your first name and the first letter of your surname (for example, Thando D.). Only our staff see your full legal name.",
        "• Businesses: the phone, WhatsApp and email a business chooses to show are visible to every visitor. A street address shows only if the business publishes it; otherwise we show suburb, city and province.",
        "• Private sellers and event posters: your number stays hidden behind a Show number button. Any visitor can tap it after a quick bot check; taps are limited per visitor so numbers cannot be collected in bulk.",
        "• Your ID number, ID images, selfie and verification files are never shown publicly.",
      ],
    },
    {
      id: "retention",
      navLabel: "Retention & deletion",
      title: "Data retention and deletion",
      content: [
        "We retain account data while your account is active. After account deletion, some records may be retained for fraud prevention, accounting, dispute handling, legal obligations, or platform integrity before deletion or anonymisation.",
        "Posts are deleted 3 days after their plan ends or after you mark them sold, and events when they end, together with their photos, videos and enquiries. A pending payment, an open report or a legal hold can delay deletion.",
        "Enquiries are deleted with the post, or 1 year after they were sent. Notices in your account are deleted after 90 days.",
        evidenceRetention,
        "Staff access logs, moderation records and closed reports are kept for 2 years. Requests from authorities about you are logged and kept while your account exists and for 5 years after it closes. For a data-rights request, your contact details are removed within 30 days after it is closed and the record of it is kept for 5 years.",
        "When you close your account, you are signed out at once and your posts leave public view. Thirty days later your account, posts, enquiries and media are erased, and your home area, your records of accepting our Terms and your email choices are deleted. Payments and invoices are kept for tax and accounting, no longer linked to you. Limited records may remain where the law, abuse prevention or an unresolved dispute requires it.",
      ],
    },
    {
      id: "popia-rights",
      navLabel: "Your POPIA rights",
      title: "Your rights under POPIA",
      content: [
        "As a data subject in South Africa, you have the right to:",
        "• Access your personal information we hold",
        "• Request correction or deletion of your data",
        "• Object to processing of your data",
        "• Request information about the parties who received your personal information",
        "• Ask a person to look again at an automatic ID decision, within 5 days",
        "• Lodge a complaint with the Information Regulator: inforegulator.org.za (complaints through its eServices portal), enquiries@inforegulator.org.za",
        "We provide a signed-in data-subject request form for access, correction, deletion, objection, and recipient-information requests.",
      ],
    },
    {
      id: "security",
      navLabel: "Security & access",
      title: "Data security and access",
      content: [
        "We use encryption in transit, restricted verification storage, signed access paths, audit controls, and operational access limits for sensitive verification files.",
        "Only authorised personnel with a platform safety, support, verification, legal, or security reason should access ID, selfie, or location evidence.",
        "If we discover a data breach that may affect your personal information, we will investigate, contain the incident, preserve evidence, notify affected users and/or regulators where required, and publish follow-up guidance when appropriate.",
      ],
    },
    {
      id: "third-parties",
      navLabel: "Third parties",
      title: "Third parties",
      content: [
        "These providers work for us under written agreements and receive only what they need:",
        "• Supabase: our database and sign-in (London, United Kingdom)",
        "• Cloudflare: hosting, security and bot checks, and storage for photos, videos and ID files (ID files are kept private and stored in Western Europe). Cloudflare is a United States company, and its network may handle a visit at a data centre near you",
        "• Didit: ID and face checks, when we use it (stored in Ireland, European Union; some of its own providers are in the United States)",
        "• Resend: our emails to you (sent from Ireland, European Union; records stored in the United States)",
        "• Zoho: the inbox for emails you send us (United States)",
        "• Africa's Talking: SMS codes (Kenya)",
        "• Sentry: error reports (United States)",
        "• Google: only if you sign in with Google (United States)",
        "Ozow receives your payment details when you pay and handles them under its own rules; we receive the payment result.",
        "Information may therefore go outside South Africa, to the United Kingdom, the European Union, the United States and Kenya. We use only providers bound by agreements that protect it to a standard substantially similar to POPIA (section 72).",
      ],
    },
  ] as const;

  const sections: LegalSection[] = [
    ...textSections.map((section) => ({
      id: section.id,
      navLabel: section.navLabel,
      title: section.title,
      content: <LegalBlocks paragraphs={section.content} />,
    })),
    {
      id: "sensitive-data",
      navLabel: "Sensitive data table",
      title: "Sensitive data handling",
      content: (
        <div className="space-y-4">
          <ul className="grid gap-3" aria-label="Sensitive data handling">
            {dataHandlingRows.map((row) => (
              <li key={row.dataType} className="surface-card p-4 sm:p-5">
                <h3 className="font-body text-base font-semibold text-foreground">
                  {row.dataType}
                </h3>
                <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  {[
                    ["Why collected", row.purpose],
                    ["Who receives it", row.recipients],
                    ["Storage period", row.retention],
                    ["Deletion process", row.deletion],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
                      <dd className="mt-1 leading-6 text-foreground/85">{value}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
          <p className="max-w-prose text-[15px] leading-7 text-foreground/80">
            Comparing your selfie with your ID photo can use biometric information, which POPIA
            treats as special personal information. We use it only to confirm who you are and to
            prevent fraud, and when Didit checks your face we ask for your consent first. It is
            never shown publicly.
          </p>
        </div>
      ),
    },
    {
      id: "contact",
      navLabel: "Contact the Information Officer",
      title: "Data subjects & contact",
      content: (
        <div className="max-w-prose space-y-4">
          <p className="text-[15px] leading-7 text-foreground/80">
            To exercise your rights under POPIA, contact our Information Officer first. If needed,
            you can continue with the signed-in data rights form.
          </p>
          <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
            <a
              href={`mailto:${trustConfig.informationOfficerEmail}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-sm text-sm font-semibold text-brand-green-700 underline underline-offset-4 hover:text-brand-green-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:text-brand-gold-300 dark:hover:text-brand-gold-100"
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
              {trustConfig.informationOfficerEmail}
            </a>
            <Link
              href="/dsar"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-input bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Open signed-in data rights form
            </Link>
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
          title="Privacy Policy"
          meta="Updated November 2026"
          description="How we collect, use and protect your personal information under POPIA."
          breadcrumbs={[{ label: "Privacy Policy" }]}
          sections={sections}
        />
      </main>

      <Footer />
    </div>
  );
}
