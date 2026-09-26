import Link from "next/link";
import { Mail } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { LegalBlocks, LegalDocument, type LegalSection } from "@/components/safety/legal-document";
import { getTrustPublicConfig } from "@/lib/trust-public-config";

export const metadata = {
  title: "Privacy Policy",
  description:
    "How VerifyMzansi collects, uses, and protects your personal information. POPIA-compliant data practices.",
};

export default function PrivacyPolicyPage() {
  const trustConfig = getTrustPublicConfig();
  const dataHandlingRows = [
    {
      dataType: "Introductory-offer identity token",
      purpose: "Prevent repeated trial claims across accounts",
      recipients: "Restricted platform fraud-prevention workflows; never public",
      retention:
        "A keyed identity token and redemption date are retained after account deletion to enforce the one-time offer",
      deletion: "Request a review through the data-rights workflow",
    },
    {
      dataType: "ID number",
      purpose: "Identity verification, duplicate-account checks, fraud prevention",
      recipients: "Internal reviewers and KYC/infrastructure providers where required",
      retention: "Successful checks: up to 90 days unless fraud, dispute, or legal hold applies",
      deletion: "Request through privacy contact or signed-in data-rights form",
    },
    {
      dataType: "ID document image",
      purpose: "Evidence review and identity matching",
      recipients: "Restricted verification reviewers and secure storage/KYC providers",
      retention:
        "Successful checks: target deletion within 30 days after review unless hold applies",
      deletion: "Reviewed against fraud, dispute, accounting, and legal-hold obligations",
    },
    {
      dataType: "Selfie image",
      purpose: "Selfie-to-ID comparison and liveness-style review where enabled",
      recipients: "Restricted verification reviewers and KYC/infrastructure providers",
      retention: "Failed checks: up to 90 days for appeal and abuse checks unless hold applies",
      deletion: "Request deletion; closed-account evidence is reviewed for deletion within 90 days",
    },
    {
      dataType: "Phone number",
      purpose: "OTP checks, account recovery, safety contact, and posting accountability",
      recipients: "SMS provider, internal platform systems, and support reviewers",
      retention: "Kept while account is active and as required for fraud or legal records",
      deletion: "Update or delete through account/data-rights workflow where legally allowed",
    },
    {
      dataType: "GPS/location",
      purpose: "Location verification and marketplace location display",
      recipients: "Internal platform systems and infrastructure providers",
      retention: "Kept while profile/listing uses the location or while needed for disputes",
      deletion: "Remove from profile/listing or request correction/deletion",
    },
    {
      dataType: "Payment data",
      purpose: "Checkout, paid placement, accounting, refunds, and dispute handling",
      recipients: "Ozow/payment provider, accounting records, and platform support",
      retention: "Payment and accounting records may be retained for up to 5 years where required",
      deletion: "Handled under provider rules and platform legal/accounting obligations",
    },
  ] as const;
  const textSections = [
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
      ],
    },
    {
      id: "verification-data",
      navLabel: "Verification data",
      title: "How verification data is used",
      content: [
        "ID numbers, ID document images, selfies, phone numbers, and location data are used to run verification checks, reduce fraud, review account safety, and support legal compliance.",
        "Verification may include internal review, automated validation checks, SMS delivery providers, secure file storage, and third-party KYC or infrastructure providers where needed to deliver the service.",
        "VerifyMzansi verifies people and account evidence. We do not verify that a business itself is official; business-profile trust signals refer to the person posting or managing the profile unless stated otherwise.",
        "Verification does not guarantee that a person, business profile, product, rental, event, job, or transaction is safe. It only means specific platform checks were completed or reviewed.",
      ],
    },
    {
      id: "retention",
      navLabel: "Retention & deletion",
      title: "Data retention and deletion",
      content: [
        "We retain account and listing data while your account is active. After account deletion, some records may be retained for fraud prevention, accounting, dispute handling, legal obligations, or platform integrity before deletion or anonymisation.",
        "Successful ID/selfie verification evidence is targeted for deletion within 30 days after review, while failed or appealed verification evidence may be retained for up to 90 days for appeal, abuse, and duplicate-account checks unless a fraud, dispute, security, accounting, or legal hold applies.",
        "After account closure, public listings and profile content may be removed or anonymised, while limited operational records may remain where required by law, accounting rules, abuse prevention, or unresolved disputes.",
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
        "• Lodge a complaint with the Information Regulator",
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
        "We may use trusted providers for hosting, storage, identity/KYC workflows, SMS delivery, email, payments, security tooling, analytics, and operational support.",
        "Providers should receive only the information needed to deliver their service and are expected to protect it under appropriate contractual, security, and POPIA-aligned obligations.",
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
            Selfie and ID-image processing may involve biometric-style comparison. Any such
            processing is used for verification and fraud prevention, not for public display.
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
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-green-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:bg-brand-green-500 dark:text-brand-green-950 dark:hover:bg-brand-green-400"
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
          meta="Updated March 2026"
          description="How we collect, use and protect your personal information under POPIA."
          breadcrumbs={[{ label: "Privacy Policy" }]}
          sections={sections}
        />
      </main>

      <Footer />
    </div>
  );
}
