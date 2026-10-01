import Link from "next/link";
import { Mail } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { LegalBlocks, LegalDocument, type LegalSection } from "@/components/safety/legal-document";
import { getTrustPublicConfig } from "@/lib/trust-public-config";

export const metadata = {
  title: "Terms of Service",
  description:
    "VerifyMzansi terms of service for posting and browsing marketplace listings, business services, tourism offers, venues, and events in South Africa.",
};

export default function TermsPage() {
  const trustConfig = getTrustPublicConfig();
  const textSections = [
    {
      id: "acceptance",
      navLabel: "Acceptance",
      title: "Acceptance of terms",
      content: [
        'By accessing or using VerifyMzansi ("the Platform"), you agree to these Terms. We may modify terms at any time — continued use constitutes acceptance.',
      ],
    },
    {
      id: "registration",
      navLabel: "Account registration",
      title: "Account registration",
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
      id: "posting-obligations",
      navLabel: "Posting obligations",
      title: "Account posting obligations",
      content: [
        "As an account holder, you agree to:",
        "• Post only items, businesses, offers, or events you legally own or are authorised to advertise",
        "• Provide accurate descriptions, images, pricing, and business details",
        "• Not list prohibited items (weapons, illegal substances, counterfeit goods)",
        "• Comply with the Consumer Protection Act (CPA) of South Africa and all applicable SA laws",
        "When you tick the posting terms checkbox and submit a post, that acceptance is recorded against the submitted content and forms part of your agreement with VerifyMzansi.",
      ],
    },
    {
      id: "prohibited-content",
      navLabel: "Prohibited content",
      title: "Prohibited content",
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
      id: "verification-signals",
      navLabel: "Verification signals",
      title: "Verification signals",
      content: [
        "Verification badges and trust signals mean specific platform checks were completed, submitted, or reviewed for the person or account using the platform.",
        "VerifyMzansi does not verify that a business itself is official. A business profile may be posted by a person who submitted phone, ID, and selfie evidence, but that does not prove the business is officially claimed unless the page says an official representative was reviewed.",
        "Verification does not guarantee that a user, business profile, product, rental, job, event, price, payment, or transaction is safe, lawful, available, or free from risk.",
        "Users must still follow safe trading practices, inspect goods, verify ownership, keep records, and report suspicious behaviour.",
      ],
    },
    {
      id: "payments",
      navLabel: "Payments & billing",
      title: "Payments & billing",
      content: [
        `Paid features are billed via secure hosted checkout in ZAR. ${
          trustConfig.ozowMerchantName
            ? `The checkout or bank record may show ${trustConfig.ozowMerchantName} as the Ozow merchant name.`
            : "The checkout or bank record should identify VerifyMzansi or its payment provider."
        }`,
        trustConfig.vatStatus
          ? `VAT status: ${trustConfig.vatStatus}.`
          : "Prices are shown in South African rand. VAT treatment will be shown on the checkout or invoice where applicable.",
        "Retail plans are prepaid for a fixed period: R50 for 30 days, R140 for 90 days or R250 for 180 days (each a fixed number of days counted from when you pay, never calendar months), as shown on the pricing page and at checkout. Each plan provides one active posting slot that can be reused when a post is sold or deactivated, subject to fair-use activation limits. Events are free until the event ends, subject to fair-use limits. Paid visibility starts only after the payment is confirmed.",
        "Plans do not auto-renew. When a plan ends, your posts become inactive and stay saved in your dashboard so you can reactivate them with a new plan. Plans purchased before September 2026 remain valid until their original expiry date.",
        "You may buy additional plans at any time to add more active posting slots. Organisation, bulk and sponsored programmes are governed by their written agreement and do not renew automatically.",
        "If paid content is rejected after moderation, VerifyMzansi may correct, resubmit, credit, or refund according to the Consumer Protection Act, the plan terms, and the payment provider record.",
        "Refunds are reviewed for rejected or failed paid content, duplicate charges, billing errors, or payment-provider failures; unused time on an active plan is not automatically refunded. A refund or chargeback withdraws the paid visibility it funded.",
        "Invoices or payment records are issued from the billing flow or support channel after successful payment confirmation.",
      ],
    },
    {
      id: "trials",
      navLabel: "Introductory trials",
      title: "Introductory trials & visibility",
      content: [
        "Eligible verified members may activate one introductory post across all three posting areas: seven days, or a limited 30-Day Free Launch Trial. Previous free-post usage counts. Activation permanently consumes the introductory benefit for the verified identity; deleting content or an account does not reset it.",
        "A free post remains visible only for the free-post visibility period shown in the posting flow. After that period expires, VerifyMzansi may automatically mark the post as expired and remove it from public browsing, search, detail pages, and promotional surfaces.",
        "Expired posts and their media remain saved in the owner dashboard for paid renewal, subject to account deletion, legal retention and safety processes. Expiry alone does not delete them.",
        "Trial duration starts at successful approval. Each posting area defaults to 50 simultaneously active 30-day customer trials; campaign settings and availability may change. Pending posts do not reserve active slots. If the pool is full at approval, the post stays pending and the owner may choose the enabled seven-day offer instead. An unactivated rejected post does not consume the benefit. Activated trials include standard placement only, with no boost, featured placement, urgent badge, automatic charge or repeated free renewal. Events end at the earlier of event end and trial expiry.",
      ],
    },
    {
      id: "promotion-rights",
      navLabel: "Promotion rights",
      title: "Promotion & distribution rights",
      content: [
        "When you create a promotion, advertisement, event, or campaign on VerifyMzansi, you confirm that you own it or are authorised to market it.",
      ],
    },
    {
      id: "liability",
      navLabel: "Limitation of liability",
      title: "Limitation of liability",
      content: [
        "VerifyMzansi connects buyers, account holders, businesses, and advertisers — we are not a party to transactions. We do not guarantee quality, safety, or legality of listed items or promotions. Liability is limited to the maximum extent permitted by SA law.",
      ],
    },
  ];

  const sections: LegalSection[] = [
    ...textSections.map((section) => ({
      id: section.id,
      navLabel: section.navLabel,
      title: section.title,
      content: <LegalBlocks paragraphs={section.content} />,
    })),
    {
      id: "privacy-contact",
      navLabel: "Privacy & contact",
      title: "Privacy & contact",
      content: (
        <div className="max-w-prose space-y-4">
          <p className="text-[15px] leading-7 text-foreground/80">
            Your use of VerifyMzansi is also governed by our Privacy Policy.
          </p>
          <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
            <Link
              href="/privacy"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-input bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              View Privacy Policy
            </Link>
            <a
              href="mailto:legal@verifymzansi.com"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-green-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:bg-brand-green-500 dark:text-brand-green-950 dark:hover:bg-brand-green-400"
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
              legal@verifymzansi.com
            </a>
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
          title="Terms of Service"
          meta="Updated May 2026"
          description="Governed by South African law."
          breadcrumbs={[{ label: "Terms of Service" }]}
          sections={sections}
        />
      </main>

      <Footer />
    </div>
  );
}
