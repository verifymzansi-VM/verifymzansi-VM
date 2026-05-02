import { Mail } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import Link from "next/link";
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
  const sections = [
    {
      title: "1. Information We Collect",
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
      title: "2. How Verification Data Is Used",
      content: [
        "ID numbers, ID document images, selfies, phone numbers, and location data are used to run verification checks, reduce fraud, review account safety, and support legal compliance.",
        "Verification may include internal review, automated validation checks, SMS delivery providers, secure file storage, and third-party KYC or infrastructure providers where needed to deliver the service.",
        "VerifyMzansi verifies people and account evidence. We do not verify that a business itself is official; business-profile trust signals refer to the person posting or managing the profile unless stated otherwise.",
        "Verification does not guarantee that a person, business profile, product, rental, event, job, or transaction is safe. It only means specific platform checks were completed or reviewed.",
      ],
    },
    {
      title: "3. Data Retention and Deletion",
      content: [
        "We retain account and listing data while your account is active. After account deletion, some records may be retained for fraud prevention, accounting, dispute handling, legal obligations, or platform integrity before deletion or anonymisation.",
        "Successful ID/selfie verification evidence is targeted for deletion within 30 days after review, while failed or appealed verification evidence may be retained for up to 90 days for appeal, abuse, and duplicate-account checks unless a fraud, dispute, security, accounting, or legal hold applies.",
        "After account closure, public listings and profile content may be removed or anonymised, while limited operational records may remain where required by law, accounting rules, abuse prevention, or unresolved disputes.",
      ],
    },
    {
      title: "4. Your Rights Under POPIA",
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
      title: "5. Data Security and Access",
      content: [
        "We use encryption in transit, restricted verification storage, signed access paths, audit controls, and operational access limits for sensitive verification files.",
        "Only authorised personnel with a platform safety, support, verification, legal, or security reason should access ID, selfie, or location evidence.",
        "If we discover a data breach that may affect your personal information, we will investigate, contain the incident, preserve evidence, notify affected users and/or regulators where required, and publish follow-up guidance when appropriate.",
      ],
    },
    {
      title: "6. Third Parties",
      content: [
        "We may use trusted providers for hosting, storage, identity/KYC workflows, SMS delivery, email, payments, security tooling, analytics, and operational support.",
        "Providers should receive only the information needed to deliver their service and are expected to protect it under appropriate contractual, security, and POPIA-aligned obligations.",
      ],
    },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1 bg-gradient-to-b from-muted/30 to-background">
        <div className="bg-brand-green-950/20 dark:bg-black py-4 sm:py-5 border-b">
          <div className="container-page text-center max-w-3xl space-y-1">
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">
              Privacy Policy
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Last updated: March 2026 · POPIA compliant
            </p>
          </div>
        </div>

        <div className="container-page py-4 max-w-4xl">
          <div className="space-y-4">
            <div className="space-y-4">
              {sections.map((section, index) => (
                <section key={index} className="space-y-1.5 group">
                  <h2 className="font-display text-base font-bold flex items-center gap-2">
                    <span className="text-brand-green text-sm font-mono" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {section.title.replace(/^\d+\.\s*/, "")}
                  </h2>
                  <div className="space-y-1 pl-6 text-muted-foreground leading-snug">
                    {section.content.map((paragraph, pIdx) =>
                      paragraph.startsWith("•") ? (
                        <div key={pIdx} className="flex gap-2 text-sm">
                          <span className="text-brand-green mt-0.5" aria-hidden="true">
                            •
                          </span>
                          <span>{paragraph.replace("• ", "")}</span>
                        </div>
                      ) : (
                        <p key={pIdx} className="text-sm">
                          {paragraph}
                        </p>
                      )
                    )}
                  </div>
                </section>
              ))}

              <section className="space-y-2 pt-1">
                <h2 className="font-display text-base font-bold flex items-center gap-2">
                  <span className="text-brand-green text-sm font-mono" aria-hidden="true">
                    07
                  </span>
                  Sensitive Data Handling
                </h2>
                <div
                  className="overflow-x-auto pl-0 sm:pl-6"
                  role="region"
                  aria-label="Sensitive data handling table"
                  tabIndex={0}
                >
                  <table className="w-full min-w-[720px] border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b bg-muted/50 text-foreground">
                        <th className="p-2 font-semibold">Data type</th>
                        <th className="p-2 font-semibold">Why collected</th>
                        <th className="p-2 font-semibold">Who receives it</th>
                        <th className="p-2 font-semibold">Storage period</th>
                        <th className="p-2 font-semibold">Deletion process</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dataHandlingRows.map((row) => (
                        <tr key={row.dataType} className="border-b align-top text-muted-foreground">
                          <td className="p-2 font-medium text-foreground">{row.dataType}</td>
                          <td className="p-2">{row.purpose}</td>
                          <td className="p-2">{row.recipients}</td>
                          <td className="p-2">{row.retention}</td>
                          <td className="p-2">{row.deletion}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="pl-0 text-sm text-muted-foreground sm:pl-6">
                  Selfie and ID-image processing may involve biometric-style comparison. Any such
                  processing is used for verification and fraud prevention, not for public display.
                </p>
              </section>

              <section className="space-y-1.5 pt-1">
                <h2 className="font-display text-base font-bold flex items-center gap-2">
                  <span className="text-brand-green text-sm font-mono" aria-hidden="true">
                    08
                  </span>
                  Data Subjects & Contact
                </h2>
                <div className="pl-6 space-y-2">
                  <p className="text-sm text-muted-foreground leading-snug">
                    To exercise your rights under POPIA, contact our Information Officer first. If
                    needed, you can continue with the signed-in data rights form.
                  </p>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <a
                      href={`mailto:${trustConfig.informationOfficerEmail}`}
                      className="group flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-green/10 hover:bg-brand-green/20 text-brand-green transition-colors text-sm font-medium w-fit border border-brand-green/20"
                    >
                      <Mail className="h-4 w-4" />
                      {trustConfig.informationOfficerEmail}
                    </a>

                    <Link
                      href="/dsar"
                      className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground w-fit self-center sm:self-auto"
                    >
                      Open signed-in data rights form
                    </Link>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
