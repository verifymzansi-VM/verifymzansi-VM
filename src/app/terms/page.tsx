import { Mail, ArrowRight } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import Link from "next/link";

export const metadata = {
  title: "Terms of Service",
  description:
    "VerifyMzansi terms of service — rules, responsibilities, and usage policies for South Africa's verification-first marketplace.",
};

export default function TermsPage() {
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
        "To sell on VerifyMzansi, you must:",
        "• Be at least 18 years old",
        "• Provide accurate and truthful information",
        "• Complete identity verification",
        "• Maintain the security of your account credentials",
        "You are responsible for all activity under your account.",
      ],
    },
    {
      title: "3. Seller Obligations",
      content: [
        "As a seller, you agree to:",
        "• List only items you legally own or are authorised to sell",
        "• Provide accurate descriptions, images, and pricing",
        "• Not list prohibited items (weapons, illegal substances, counterfeit goods)",
        "• Comply with the Consumer Protection Act and all applicable SA laws",
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
      title: "5. Payments & Billing",
      content: [
        "Paid features are billed via PayFast in ZAR (incl. VAT). Subscriptions auto-renew unless cancelled. Refunds follow CPA guidelines.",
      ],
    },
    {
      title: "6. Limitation of Liability",
      content: [
        "VerifyMzansi connects buyers and sellers — we are not a party to transactions. We do not guarantee quality, safety, or legality of listed items. Liability is limited to the maximum extent permitted by SA law.",
      ],
    },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1 bg-gradient-to-b from-muted/30 to-background">
        {/* Compact Header */}
        <div className="bg-brand-green-950/20 dark:bg-black py-8 sm:py-10 border-b">
          <div className="container-page text-center max-w-3xl space-y-2">
            <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight">
              Terms of Service
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground">
              Last updated: February 2026 · Governed by South African law
            </p>
          </div>
        </div>

        <div className="container-page py-8 max-w-4xl">
          <div className="space-y-6">
            {/* Legal Content */}
            <div className="space-y-6">
              {sections.map((section, index) => (
                <section key={index} className="space-y-3 group">
                  <h2 className="font-display text-xl font-bold flex items-center gap-3">
                    <span className="text-brand-green text-lg font-mono" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {section.title.replace(/^\d+\.\s*/, "")}
                  </h2>
                  <div className="space-y-2 pl-8 text-muted-foreground leading-relaxed">
                    {section.content.map((paragraph, pIdx) =>
                      paragraph.startsWith("•") ? (
                        <div key={pIdx} className="flex gap-2 text-[15px]">
                          <span className="text-brand-green mt-0.5" aria-hidden="true">
                            •
                          </span>
                          <span>{paragraph.replace("• ", "")}</span>
                        </div>
                      ) : (
                        <p key={pIdx} className="text-[15px]">
                          {paragraph}
                        </p>
                      )
                    )}
                  </div>
                </section>
              ))}

              <section className="space-y-3 pt-2">
                <h2 className="font-display text-xl font-bold flex items-center gap-3">
                  <span className="text-brand-green text-lg font-mono" aria-hidden="true">
                    07
                  </span>
                  Privacy & Contact
                </h2>
                <div className="pl-8 space-y-4">
                  <p className="text-[15px] text-muted-foreground leading-relaxed">
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
                      href="mailto:legal@verifymzansi.co.za"
                      className="group flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-green/10 hover:bg-brand-green/20 text-brand-green transition-colors text-sm font-medium w-fit border border-brand-green/20"
                    >
                      <Mail className="h-4 w-4" />
                      legal@verifymzansi.co.za
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
