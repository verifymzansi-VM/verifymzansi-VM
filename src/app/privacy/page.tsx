import { Mail, ArrowRight } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import Link from "next/link";

export const metadata = {
  title: "Privacy Policy",
  description:
    "How VerifyMzansi collects, uses, and protects your personal information. POPIA-compliant data practices.",
};

export default function PrivacyPolicyPage() {
  const sections = [
    {
      title: "1. Information We Collect",
      content: [
        "We collect information you provide directly:",
        "• Account information (name, email, phone number)",
        "• Verification documents (ID number, selfie, location)",
        "• Listing content (titles, descriptions, images, pricing)",
        "• Communication records and payment information (via PayFast)",
        "We also collect device/browser info, IP address, and usage data automatically.",
      ],
    },
    {
      title: "2. How We Use Your Information",
      content: [
        "• To verify your identity and build your trust profile",
        "• To display your listings and process transactions",
        "• To communicate service updates and safety alerts",
        "• To prevent fraud, scams, and abuse",
        "• To comply with legal obligations",
      ],
    },
    {
      title: "3. Data Retention",
      content: [
        "We retain your data while your account is active. After deletion, certain data is kept for up to 90 days for fraud prevention, then permanently erased. Verification documents are purged after successful verification per POPIA's data minimisation principle.",
      ],
    },
    {
      title: "4. Your Rights Under POPIA",
      content: [
        "As a data subject in South Africa, you have the right to:",
        "• Access your personal information we hold",
        "• Request correction or deletion of your data",
        "• Object to processing of your data",
        "• Lodge a complaint with the Information Regulator",
      ],
    },
    {
      title: "5. Data Security",
      content: [
        "We implement industry-standard security: encryption in transit (TLS 1.3), encryption at rest, and regular security audits. Access is restricted to authorised personnel only.",
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
              Last updated: February 2026 · POPIA compliant
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
                        <div key={pIdx} className="flex gap-2 text-[13px]">
                          <span className="text-brand-green mt-0.5" aria-hidden="true">
                            •
                          </span>
                          <span>{paragraph.replace("• ", "")}</span>
                        </div>
                      ) : (
                        <p key={pIdx} className="text-[13px]">
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
                    06
                  </span>
                  Data Subjects & Contact
                </h2>
                <div className="pl-6 space-y-2">
                  <p className="text-[13px] text-muted-foreground leading-snug">
                    To exercise your rights under POPIA, submit an access request or contact our
                    Information Officer.
                  </p>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <Link
                      href="/dsar"
                      className="group flex items-center gap-2 px-4 py-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors text-sm font-medium w-fit border text-foreground"
                    >
                      Submit Data Access Request
                      <ArrowRight className="h-4 w-4 text-foreground/70 group-hover:translate-x-1 transition-transform" />
                    </Link>

                    <a
                      href="mailto:privacy@verifymzansi.com"
                      className="group flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-green/10 hover:bg-brand-green/20 text-brand-green transition-colors text-sm font-medium w-fit border border-brand-green/20"
                    >
                      <Mail className="h-4 w-4" />
                      privacy@verifymzansi.com
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
