import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import {
  Car,
  Home,
  Wrench,
  Smartphone,
  Sofa,
  Briefcase,
  Building2,
  Megaphone,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { MarketplacePreviewsSkeleton } from "@/components/home/marketplace-previews-skeleton";
import { HeroBannerWithData } from "@/components/home/hero-banner-with-data";
import { HeroBannerSkeleton } from "@/components/home/hero-banner-skeleton";
import { HomeMzansiMarketShowcase } from "@/components/home/home-mzansi-market-showcase";

export const metadata: Metadata = {
  title: "VerifyMzansi — SA's Trusted Marketplace",
  description:
    "Buy & sell with verified sellers. South Africa's verification-first marketplace for classifieds, businesses, and promotions.",
  openGraph: {
    title: "VerifyMzansi — SA's Trusted Marketplace",
    description:
      "Buy & sell with verified sellers. South Africa's verification-first marketplace for classifieds, businesses, and promotions.",
  },
};

/** Revalidate homepage data every 60 seconds (ISR) */
export const revalidate = 60;

export default async function HomePage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://verifymzansi.com";

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        name: "VerifyMzansi",
        url: url || "https://verifymzansi.com",
        description:
          "South Africa's verification-first marketplace for classifieds, shops, and business services.",
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${url || "https://verifymzansi.com"}/mzansi-market?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "Organization",
        name: "VerifyMzansi",
        url: url || "https://verifymzansi.com",
        logo: `${url || "https://verifymzansi.com"}/icons/icon-512x512.png`,
        sameAs: [],
        contactPoint: {
          "@type": "ContactPoint",
          email: "hello@verifymzansi.co.za",
          contactType: "customer support",
        },
      },
    ],
  };

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <main className="flex-1">
        {/* ═══ Hero Banner (rotating promotions + search) ═══ */}
        <Suspense fallback={<HeroBannerSkeleton />}>
          <HeroBannerWithData />
        </Suspense>

        {/* ═══ Browse by Category ═══ */}
        <section className="py-5 sm:py-8 border-b border-warm-200 dark:border-warm-800 bg-white dark:bg-warm-950">
          <div className="container-page">
            <div className="grid grid-cols-4 sm:grid-cols-4 md:grid-cols-8 gap-3">
              {[
                {
                  label: "Vehicles",
                  icon: Car,
                  href: "/mzansi-market?category=vehicles",
                  iconBg: "bg-blue-100 dark:bg-blue-950",
                  iconColor: "text-blue-500",
                },
                {
                  label: "Property",
                  icon: Home,
                  href: "/mzansi-market?category=property",
                  iconBg: "bg-teal-100 dark:bg-teal-950",
                  iconColor: "text-teal-500",
                },
                {
                  label: "Jobs",
                  icon: Briefcase,
                  href: "/mzansi-market?category=jobs_services",
                  iconBg: "bg-violet-100 dark:bg-violet-950",
                  iconColor: "text-violet-500",
                },
                {
                  label: "Electronics",
                  icon: Smartphone,
                  href: "/mzansi-market?category=electronics",
                  iconBg: "bg-gray-100 dark:bg-gray-800",
                  iconColor: "text-gray-500 dark:text-gray-400",
                },
                {
                  label: "Auto Parts",
                  icon: Wrench,
                  href: "/mzansi-market?category=auto_parts",
                  iconBg: "bg-rose-100 dark:bg-rose-950",
                  iconColor: "text-rose-400",
                },
                {
                  label: "Home & Living",
                  icon: Sofa,
                  href: "/mzansi-market?category=home_lifestyle",
                  iconBg: "bg-green-100 dark:bg-green-950",
                  iconColor: "text-green-500",
                },
                {
                  label: "Business",
                  icon: Building2,
                  href: "/mzansi-business",
                  iconBg: "bg-blue-100 dark:bg-blue-950",
                  iconColor: "text-blue-500",
                },
                {
                  label: "Promotions",
                  icon: Megaphone,
                  href: "/promotions",
                  iconBg: "bg-red-100 dark:bg-red-950",
                  iconColor: "text-red-500",
                },
              ].map(({ label, icon: Icon, href, iconBg, iconColor }) => (
                <Link
                  key={label}
                  href={href}
                  className="group flex flex-col items-center gap-2 p-3 rounded-xl border border-warm-200 dark:border-warm-700 bg-white dark:bg-warm-900 hover:shadow-md hover:border-warm-300 dark:hover:border-warm-600 transition-all duration-200"
                >
                  <div
                    className={`flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-full ${iconBg} ${iconColor} transition-transform duration-200 group-hover:scale-110`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="text-xs font-medium text-center text-foreground leading-tight">
                    {label}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* ═══ Marketplace Showcase ═══ */}
        <Suspense fallback={<MarketplacePreviewsSkeleton />}>
          <HomeMzansiMarketShowcase />
        </Suspense>

        {/* ═══ CTA Section ═══ */}
        <section className="py-4 sm:py-6 relative overflow-hidden bg-warm-950 dark:bg-black">
          <div className="container-page relative z-10">
            <div className="bg-gradient-to-br from-warm-900/50 to-warm-950/80 backdrop-blur-xl border border-white/10 rounded-2xl p-4 sm:p-5 text-center shadow-2xl overflow-hidden relative">
              <div className="max-w-3xl mx-auto space-y-3 relative z-10">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-brand-green-400 text-xs font-medium">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-brand-green-400 opacity-50"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-green-500"></span>
                  </span>
                  Join verified users
                </div>

                <h1 className="font-display text-2xl sm:text-4xl font-bold tracking-tight text-white leading-[1.1]">
                  Join Mzansi&apos;s{" "}
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-green-400 to-brand-gold-400">
                    Trusted Marketplace
                  </span>
                </h1>

                <p className="text-warm-200 text-base max-w-2xl mx-auto">
                  Get verified in under 5 minutes. Buy, sell, and advertise with trust.
                </p>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <Button
                    asChild
                    size="lg"
                    className="w-full sm:w-auto h-12 px-8 text-base bg-brand-green hover:bg-brand-green-600 text-white transition-all gap-2 rounded-full font-semibold"
                  >
                    <Link href="/register">
                      <ShieldCheck className="h-5 w-5" />
                      Register Now
                    </Link>
                  </Button>
                  <Button
                    asChild
                    size="lg"
                    variant="outline"
                    className="w-full sm:w-auto h-12 px-8 text-base border-white/20 bg-white/5 text-white hover:bg-white/10 hover:border-white/30 rounded-full font-semibold backdrop-blur-sm transition-all"
                  >
                    <Link href="/pricing">View Plans</Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
