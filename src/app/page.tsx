import { Suspense } from "react";
import Link from "next/link";
import {
  Car,
  Home,
  Wrench,
  Smartphone,
  Sofa,
  Briefcase,
  Store,
  Building2,
  Megaphone,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { MarketplacePreviewsSkeleton } from "@/components/home/marketplace-previews-skeleton";
import { HeroBanner } from "@/components/home/hero-banner";
import { HomeMallShopsShowcase } from "@/components/home/home-mall-shops-showcase";
import { HomeBusinessAdsShowcase } from "@/components/home/home-business-ads-showcase";
import { HomeMzansiMarketShowcase } from "@/components/home/home-mzansi-market-showcase";
import { createClient } from "@supabase/supabase-js";

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Revalidate homepage data every 60 seconds (ISR) */
export const revalidate = 60;

export default async function HomePage() {
  // Use raw supabase-js client to avoid reading Next.js cookies(),
  // which would force the route to be dynamic and break ISR fetching.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let premiumShops = null;
  let topBusinesses = null;
  let latestListings = null;

  if (url && anonKey && isValidHttpUrl(url)) {
    const supabase = createClient(url, anonKey);

    // Fetch data for Hero Banner showcases
    const [shops, businesses, listings] = await Promise.all([
      supabase
        .from("storefronts")
        .select(
          "id, mall_name, cover_photo, cover_video, location_city, description, storefront_posts(id, title, type, valid_until)"
        )
        .eq("status", "live")
        .order("created_at", { ascending: false })
        .limit(3),
      supabase
        .from("business_profiles")
        .select("id, business_name, cover_photo, cover_video, about, service_areas")
        .eq("status", "live")
        .order("created_at", { ascending: false })
        .limit(3),
      supabase
        .from("listings")
        .select(
          "id, title, description, price_cents, photos, videos, video_thumbnail, location_city, category"
        )
        .eq("status", "live")
        .eq("area", "MZANSI_MARKET")
        .order("featured", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(3),
    ]);

    premiumShops = shops.data;
    topBusinesses = businesses.data;
    latestListings = listings.data;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        {/* ═══ Hero Banner (rotating promotions + search) ═══ */}
        <HeroBanner
          premiumShops={premiumShops || []}
          topBusinesses={topBusinesses || []}
          latestListings={latestListings || []}
        />

        {/* ═══ Browse by Category ═══ */}
        <section className="py-5 sm:py-8 border-b border-warm-200 dark:border-warm-800 bg-white dark:bg-warm-950">
          <div className="container-page">
            <div className="grid grid-cols-3 sm:grid-cols-9 gap-3">
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
                  iconColor: "text-gray-500",
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
                  label: "Mall Shops",
                  icon: Store,
                  href: "/mall-shops",
                  iconBg: "bg-amber-100 dark:bg-amber-950",
                  iconColor: "text-amber-500",
                },
                {
                  label: "Businesses",
                  icon: Building2,
                  href: "/business-ads",
                  iconBg: "bg-purple-100 dark:bg-purple-950",
                  iconColor: "text-purple-500",
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

        {/* ═══ Distinct Showcases ═══ */}
        <Suspense fallback={<MarketplacePreviewsSkeleton />}>
          <HomeMallShopsShowcase />
        </Suspense>

        <Suspense fallback={<MarketplacePreviewsSkeleton />}>
          <HomeBusinessAdsShowcase />
        </Suspense>

        <Suspense fallback={<MarketplacePreviewsSkeleton />}>
          <HomeMzansiMarketShowcase />
        </Suspense>

        {/* ═══ CTA Section ═══ */}
        <section className="py-8 sm:py-20 relative overflow-hidden bg-warm-950 dark:bg-black">
          {/* Decorative background elements */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full max-w-[1000px] bg-gradient-to-b from-brand-green/20 via-brand-green/5 to-transparent blur-3xl rounded-t-[100%] pointer-events-none opacity-50"></div>
          <div className="absolute inset-0 bg-[url('/noise.png')] opacity-[0.03] mix-blend-overlay pointer-events-none"></div>

          <div className="container-page relative z-10">
            <div className="bg-gradient-to-br from-warm-900/50 to-warm-950/80 backdrop-blur-xl border border-white/10 rounded-3xl p-6 sm:p-10 lg:p-16 text-center shadow-2xl overflow-hidden relative">
              {/* Card internal glows */}
              <div className="absolute -top-24 -right-24 w-64 h-64 bg-brand-gold-500/20 blur-[80px] rounded-full pointer-events-none"></div>
              <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-brand-blue-500/20 blur-[80px] rounded-full pointer-events-none"></div>

              <div className="max-w-3xl mx-auto space-y-8 relative z-10">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-brand-green-400 text-sm font-medium">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-green-500"></span>
                  </span>
                  Join a growing community of verified users
                </div>

                <h1 className="font-display text-3xl sm:text-5xl font-bold tracking-tight text-white leading-[1.1] sm:leading-[1.1]">
                  Ready to join Mzansi&apos;s most{" "}
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-green-400 to-brand-gold-400">
                    trusted marketplace?
                  </span>
                </h1>

                <p className="text-warm-200 text-lg sm:text-xl max-w-2xl mx-auto">
                  Get verified in under 5 minutes. Buy, sell, and advertise with trust. Access three
                  connected marketplaces and reach customers across South Africa.
                </p>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
                  <Button
                    asChild
                    size="lg"
                    className="w-full sm:w-auto h-14 px-8 text-lg bg-brand-green hover:bg-brand-green-600 text-white shadow-[0_0_40px_-10px_rgba(22,163,74,0.6)] hover:shadow-[0_0_60px_-15px_rgba(22,163,74,0.8)] transition-all gap-2 rounded-full font-semibold"
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
                    className="w-full sm:w-auto h-14 px-8 text-lg border-white/20 bg-white/5 text-white hover:bg-white/10 hover:border-white/30 rounded-full font-semibold backdrop-blur-sm transition-all"
                  >
                    <Link href="/pricing">View Plans</Link>
                  </Button>
                </div>

                <div className="pt-6 font-medium text-sm text-warm-400">
                  Already have an account?{" "}
                  <Link
                    href="/login"
                    className="text-white hover:text-brand-gold-400 transition-colors underline underline-offset-4"
                  >
                    Sign in
                  </Link>
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
