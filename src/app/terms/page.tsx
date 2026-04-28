import { Mail, ArrowRight } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import Link from "next/link";
import { getTrustPublicConfig } from "@/lib/trust-public-config";

export const metadata = {
  title: "Terms of Service",
  description:
    "VerifyMzansi terms of service — rules, responsibilities, and usage policies for South Africa's verification-first marketplace.",
};

export default function TermsPage() {
  const trustConfig = getTrustPublicConfig();
  const sections = [
    {
      title: "1. Acceptance of Terms",
      content: [
        'By accessing or using VerifyMzansi ("the Platform"), you agree to these Terms. We may modify terms at any time — continued use constitutes acceptance.',
      ],
    },
    {
      title: "2. Account Registration",
      content: [
        "To post on VerifyMzansi, you must:",
        "• Be at least 18 years old",
        "• Provide accurate and truthful information",
        "• Complete identity verification",
        "• Maintain the security of your account credentials",
        "You are responsible for all activity under your account.",
      ],
    },
    {
      title: "3. Account Posting Obligations",
      content: [
        "As an account holder, you agree to:",
        "• Post only items, businesses, offers, or events you legally own or are authorised to advertise",
        "• Provide accurate descriptions, images, pricing, and business details",
        "• Not list prohibited items (weapons, illegal substances, counterfeit goods)",
        "• Comply with the Consumer Protection Act (CPA) of South Africa and all applicable SA laws",
      ],
    },
    {
      title: "4. Prohibited Content",
      content: [
        "Strictly prohibited on VerifyMzansi:",
        "• Fraudulent, misleading, or deceptive listings",
        "• Hate speech, harassment, or discriminatory content",
        "• Illegal goods, spam, phishing, or malware",
        "• Impersonation or IP infringement",
        "Violation may result in immediate suspension or permanent ban without refund.",
      ],
    },
    {
      title: "5. Verification Signals",
      content: [
        "Verification badges and trust signals mean specific platform checks were completed, submitted, or reviewed for the person or account using the platform.",
        "VerifyMzansi does not verify that a business itself is official. A business profile may be posted by a person who submitted phone, ID, and selfie evidence, but that does not prove the business is officially claimed unless the page says an official representative was reviewed.",
        "Verification does not guarantee that a user, business profile, product, rental, job, event, price, payment, or transaction is safe, lawful, available, or free from risk.",
        "Users must still follow safe trading practices, inspect goods, verify ownership, keep records, and report suspicious behaviour.",
      ],
    },
    {
      title: "6. Payments & Billing",
      content: [
        `Paid features are billed via secure hosted checkout in ZAR. ${
          trustConfig.ozowMerchantName
            ? `The checkout or bank record may show ${trustConfig.ozowMerchantName} as the Ozow merchant name.`
            : "The checkout or bank record should identify VerifyMzansi or its payment provider."
        }`,
        trustConfig.vatStatus
          ? `VAT status: ${trustConfig.vatStatus}.`
          : "Prices are shown in South African rand. VAT treatment will be shown on the checkout or invoice where applicable.",
        "Marketplace plans create a 30-day subscription entitlement after successful checkout. Add-ons and other features may be once-off where the checkout says so. No payment is completed until you approve the hosted checkout.",
        "An active entitlement must be cancelled or allowed to expire before switching to another plan for the same area.",
        "If paid content is rejected after moderation, VerifyMzansi may correct, resubmit, credit, or refund according to the Consumer Protection Act, the plan terms, and the payment provider record.",
        "Invoices or payment records are issued from the billing flow or support channel after successful payment confirmation.",
      ],
    },
    {
      title: "7. Promotion & Distribution Rights",
      content: [
        "When you create a promotion, advertisement, event, or campaign on VerifyMzansi, you confirm that you own it or are authorised to market it.",
      ],
    },
    {
      title: "8. Limitation of Liability",
      content: [
        "VerifyMzansi connects buyers, account holders, businesses, and advertisers — we are not a party to transactions. We do not guarantee quality, safety, or legality of listed items or promotions. Liability is limited to the maximum extent permitted by SA law.",
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
              Terms of Service
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Last updated: March 2026 · Governed by South African law
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

              <section className="space-y-1.5 pt-1">
                <h2 className="font-display text-base font-bold flex items-center gap-2">
                  <span className="text-brand-green text-sm font-mono" aria-hidden="true">
                    09
                  </span>
                  Privacy & Contact
                </h2>
                <div className="pl-6 space-y-2">
                  <p className="text-sm text-muted-foreground leading-snug">
                    Your use of VerifyMzansi is also governed by our Privacy Policy.
                  </p>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <Link
                      href="/privacy"
                      className="group flex items-center gap-2 px-4 py-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors text-sm font-medium w-fit border text-foreground"
                    >
                      View Privacy Policy
                      <ArrowRight className="h-4 w-4 text-foreground/70 group-hover:translate-x-1 transition-transform" />
                    </Link>

                    <a
                      href="mailto:legal@verifymzansi.com"
                      className="group flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-green/10 hover:bg-brand-green/20 text-brand-green transition-colors text-sm font-medium w-fit border border-brand-green/20"
                    >
                      <Mail className="h-4 w-4" />
                      legal@verifymzansi.com
                    </a>
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
