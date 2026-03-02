"use client";

import { Scale, AlertTriangle, ShieldCheck, Mail, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import Link from "next/link";
import { motion, type Variants } from "framer-motion";

export default function TermsPage() {
  const container: Variants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.1 },
    },
  };

  const item: Variants = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } },
  };

  const sections = [
    {
      title: "1. Acceptance of Terms",
      content: [
        'By accessing or using VerifyMzansi ("the Platform"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Platform.',
        "We reserve the right to modify these terms at any time. Continued use of the Platform after changes constitutes acceptance of the new terms.",
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
        "You are responsible for all activity that occurs under your account. Notify us immediately of any unauthorised access.",
      ],
    },
    {
      title: "3. Seller Obligations",
      content: [
        "As a seller, you agree to:",
        "• List only items and services you legally own or are authorised to sell",
        "• Provide accurate descriptions, images, and pricing",
        "• Not list prohibited items (weapons, illegal substances, counterfeit goods, stolen property)",
        "• Respond to buyer enquiries in good faith",
        "• Comply with the Consumer Protection Act (CPA) and all applicable SA laws",
      ],
    },
    {
      title: "4. Prohibited Content",
      content: [
        "The following is strictly prohibited on VerifyMzansi:",
        "• Fraudulent, misleading, or deceptive listings",
        "• Hate speech, harassment, or discriminatory content",
        "• Illegal goods or services",
        "• Spam, phishing, or malware distribution",
        "• Impersonation of other users or entities",
        "• Content that infringes intellectual property rights",
        "Violation may result in immediate account suspension or permanent ban without refund.",
      ],
    },
    {
      title: "5. Payments & Billing",
      content: [
        "Paid features (premium listings, storefronts, business profiles) are billed through PayFast. Prices are in South African Rand (ZAR) and include VAT where applicable.",
        "Subscriptions auto-renew unless cancelled before the renewal date. Refunds are handled in accordance with the CPA and our refund policy.",
      ],
    },
    {
      title: "6. Limitation of Liability",
      content: [
        "VerifyMzansi is a platform connecting buyers and sellers. We are not a party to transactions between users. We do not guarantee the quality, safety, or legality of listed items.",
        "To the maximum extent permitted by SA law, VerifyMzansi shall not be liable for any indirect, incidental, or consequential damages arising from use of the Platform.",
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
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="container-page relative z-10 text-center max-w-3xl space-y-4"
          >
            <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight">
              Terms of Service
            </h1>
            <p className="text-lg text-muted-foreground">
              Last updated: February 2026. By using VerifyMzansi, you agree to these terms. Please
              read them carefully.
            </p>
          </motion.div>
        </div>

        <div className="container-page py-12 max-w-4xl">
          <motion.div variants={container} initial="hidden" animate="show" className="space-y-12">
            {/* Key Points */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {[
                {
                  icon: ShieldCheck,
                  title: "Verified Platform",
                  desc: "All sellers complete identity verification before listing.",
                },
                {
                  icon: Scale,
                  title: "SA Law Applies",
                  desc: "Governed exclusively by the laws of South Africa.",
                },
                {
                  icon: AlertTriangle,
                  title: "Your Responsibility",
                  desc: "Users are fully responsible for their listings and conduct.",
                },
              ].map((point, index) => {
                const Icon = point.icon;
                return (
                  <motion.div variants={item} key={index}>
                    <Card className="h-full border-border/50 shadow-sm hover:shadow-md transition-shadow bg-background/50 backdrop-blur-sm">
                      <CardContent className="p-6">
                        <div className="h-10 w-10 rounded-full bg-brand-green/10 flex items-center justify-center mb-4">
                          <Icon className="h-5 w-5 text-brand-green" />
                        </div>
                        <h3 className="font-semibold text-base mb-1">{point.title}</h3>
                        <p className="text-sm text-muted-foreground">{point.desc}</p>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </div>

            <div className="w-full h-px bg-border/50" />

            {/* Legal Content */}
            <div className="space-y-10">
              {sections.map((section, index) => (
                <motion.section variants={item} key={index} className="space-y-4 group">
                  <h2 className="font-display text-2xl font-bold flex items-center gap-3">
                    <span className="text-brand-green text-xl font-mono" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {section.title.replace(/^\d+\.\s*/, "")}
                  </h2>
                  <div className="space-y-3 pl-8 text-muted-foreground leading-relaxed">
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
                </motion.section>
              ))}

              <motion.section variants={item} className="space-y-4 pt-4">
                <h2 className="font-display text-2xl font-bold flex items-center gap-3">
                  <span className="text-brand-green text-xl font-mono" aria-hidden="true">
                    07
                  </span>
                  Privacy & Contact
                </h2>
                <div className="pl-8 space-y-6">
                  <p className="text-[15px] text-muted-foreground leading-relaxed">
                    Your use of VerifyMzansi is also governed by our Privacy Policy, which describes
                    how we collect, use, and protect your personal information under POPIA.
                  </p>

                  <div className="flex flex-col sm:flex-row gap-4">
                    <Link
                      href="/privacy"
                      className="group hidden sm:flex items-center gap-2 px-4 py-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors text-sm font-medium w-fit border text-foreground"
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
              </motion.section>
            </div>
          </motion.div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
