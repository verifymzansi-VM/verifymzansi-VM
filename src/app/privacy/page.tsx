import { Shield, Lock, UserX, Mail, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import Link from "next/link";

export default function PrivacyPolicyPage() {
  const sections = [
    {
      title: "1. Information We Collect",
      content: [
        "We collect information you provide directly:",
        "• Account information (name, email, phone number)",
        "• Verification documents (ID number, selfie, location)",
        "• Listing content (titles, descriptions, images, pricing)",
        "• Communication records (messages between buyers and sellers)",
        "• Payment information (processed securely by PayFast)",
        "",
        "We also collect automatically:",
        "• Device and browser information",
        "• IP address and general location",
        "• Usage patterns and interaction data",
      ],
    },
    {
      title: "2. How We Use Your Information",
      content: [
        "• To verify your identity and build your trust profile",
        "• To display your listings and storefront to buyers",
        "• To process transactions and billing",
        "• To communicate service updates and safety alerts",
        "• To prevent fraud, scams, and abuse",
        "• To comply with legal obligations",
      ],
    },
    {
      title: "3. Data Retention",
      content: [
        "We retain your data for as long as your account is active. After account deletion, we retain certain data for up to 90 days for fraud prevention and legal compliance, after which it is permanently erased.",
        "Verification documents are stored securely and automatically purged after successful verification, in accordance with POPIA's data minimisation principle.",
      ],
    },
    {
      title: "4. Your Rights Under POPIA",
      content: [
        "As a data subject in South Africa, you have the right to:",
        "• Access your personal information we hold",
        "• Request correction of inaccurate data",
        "• Request deletion of your data",
        "• Object to the processing of your data",
        "• Lodge a complaint with the Information Regulator",
      ],
    },
    {
      title: "5. Data Security",
      content: [
        "We implement industry-standard security measures including encryption in transit (TLS 1.3), encryption at rest, and regular security audits. Access to personal data is restricted to authorised personnel only.",
      ],
    },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1 bg-gradient-to-b from-muted/30 to-background">
        {/* Abstract Header Background */}
        <div className="relative overflow-hidden bg-brand-green-950/20 dark:bg-black py-16 sm:py-24 border-b">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[1000px] h-full bg-brand-green-500/10 blur-[100px] rounded-full pointer-events-none" />
          <div className="container-page relative z-10 text-center max-w-3xl space-y-4">
            <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight">
              Privacy Policy
            </h1>
            <p className="text-lg text-muted-foreground">
              Last updated: February 2026. How VerifyMzansi collects, uses, and protects your
              personal information in compliance with POPIA.
            </p>
          </div>
        </div>

        <div className="container-page py-12 max-w-4xl">
          <div className="space-y-12">
            {/* Overview Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {[
                {
                  icon: Shield,
                  title: "POPIA Compliant",
                  desc: "We comply fully with South Africa's data protection laws.",
                },
                {
                  icon: Lock,
                  title: "Data Encryption",
                  desc: "Your data is encrypted in transit and at rest.",
                },
                {
                  icon: UserX,
                  title: "Your Rights",
                  desc: "You have complete control to request, edit, or delete your data.",
                },
              ].map((point, index) => {
                const Icon = point.icon;
                return (
                  <div key={index}>
                    <Card className="h-full border-border/50 shadow-sm hover:shadow-md transition-shadow bg-background">
                      <CardContent className="p-6">
                        <div className="h-10 w-10 rounded-full bg-brand-green/10 flex items-center justify-center mb-4">
                          <Icon className="h-5 w-5 text-brand-green" />
                        </div>
                        <h3 className="font-semibold text-base mb-1">{point.title}</h3>
                        <p className="text-sm text-muted-foreground">{point.desc}</p>
                      </CardContent>
                    </Card>
                  </div>
                );
              })}
            </div>

            <div className="w-full h-px bg-border/50" />

            {/* Sections */}
            <div className="space-y-10">
              {sections.map((section, index) => (
                <section key={index} className="space-y-4 group">
                  <h2 className="font-display text-2xl font-bold flex items-center gap-3">
                    <span className="text-brand-green text-xl font-mono" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {section.title.replace(/^\d+\.\s*/, "")}
                  </h2>
                  <div className="space-y-3 pl-8 text-muted-foreground leading-relaxed">
                    {section.content.map((paragraph, pIdx) => {
                      if (!paragraph) return <div key={pIdx} className="h-2" />; // Spacing
                      return paragraph.startsWith("•") ? (
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
                      );
                    })}
                  </div>
                </section>
              ))}

              <section className="space-y-4 pt-4">
                <h2 className="font-display text-2xl font-bold flex items-center gap-3">
                  <span className="text-brand-green text-xl font-mono" aria-hidden="true">
                    06
                  </span>
                  Data Subjects & Contact
                </h2>
                <div className="pl-8 space-y-6">
                  <p className="text-[15px] text-muted-foreground leading-relaxed">
                    To exercise your rights under POPIA, submit an access request securely via our
                    dedicated portal, or contact our Information Officer for privacy-related
                    queries.
                  </p>

                  <div className="flex flex-col sm:flex-row gap-4">
                    <Link
                      href="/dsar"
                      className="group hidden sm:flex items-center gap-2 px-4 py-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors text-sm font-medium w-fit border text-foreground"
                    >
                      Submit Data Access Request
                      <ArrowRight className="h-4 w-4 text-foreground/70 group-hover:translate-x-1 transition-transform" />
                    </Link>

                    <a
                      href="mailto:privacy@verifymzansi.co.za"
                      className="group flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-green/10 hover:bg-brand-green/20 text-brand-green transition-colors text-sm font-medium w-fit border border-brand-green/20"
                    >
                      <Mail className="h-4 w-4" />
                      privacy@verifymzansi.co.za
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
