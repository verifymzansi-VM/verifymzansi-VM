import { Suspense } from "react";
import Link from "next/link";
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
import { HeroBanner } from "@/components/home/hero-banner";
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

  let topBusinesses = null;
  let latestListings = null;

  if (url && anonKey && isValidHttpUrl(url)) {
    const supabase = createClient(url, anonKey);

    // Fetch data for Hero Banner showcases
    const [businesses, listings] = await Promise.all([
      supabase
        .from("businesses")
        .select("id, business_name, cover_photo, cover_video, description, location_city")
        .eq("status", "live")
        .order("boost_until", { ascending: false, nullsFirst: false })
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

    topBusinesses = businesses.data;
    latestListings = listings.data;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        {/* ═══ Hero Banner (rotating promotions + search) ═══ */}
        <HeroBanner topBusinesses={topBusinesses || []} latestListings={latestListings || []} />

        {/* ═══ Browse by Category ═══ */}
        <section className="py-5 sm:py-8 border-b border-warm-200 dark:border-warm-800 bg-white dark:bg-warm-950">
          <div className="container-page">
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
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
                  className="group flex flex-col items-center gap-2 p-3 rounded-xl border border-transparent hover:border-warm-200 dark:hover:border-warm-700 hover:bg-warm-50 dark:hover:bg-warm-900/50 hover:shadow-sm transition-all duration-300"
                >
                  <div
                    className={`flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-full ${iconBg} ${iconColor} transition-transform duration-300 ease-out group-hover:scale-110 group-hover:shadow-sm`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="text-xs font-medium text-center text-foreground leading-tight group-hover:text-brand-green transition-colors">
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
        <section className="py-12 sm:py-24 relative overflow-hidden bg-hero-mesh border-t border-brand-green-100/50 dark:border-brand-green-900/20">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-warm-100/50 dark:to-warm-950/50 pointer-events-none"></div>
          <div className="absolute inset-0 bg-[url('/noise.png')] opacity-[0.02] mix-blend-overlay pointer-events-none"></div>

          <div className="container-page relative z-10">
            <div className="bg-white/80 dark:bg-warm-950/80 backdrop-blur-xl border border-warm-200/50 dark:border-warm-800/50 rounded-3xl p-8 sm:p-12 lg:p-16 text-center shadow-xl overflow-hidden relative">
              {/* Card internal glows */}
              <div className="absolute -top-32 -right-32 w-80 h-80 bg-brand-gold-400/10 blur-[100px] rounded-full pointer-events-none"></div>
              <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-brand-green-400/10 blur-[100px] rounded-full pointer-events-none"></div>

              <div className="max-w-3xl mx-auto space-y-8 relative z-10">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand-green-50 dark:bg-brand-green-950/50 border border-brand-green-200 dark:border-brand-green-800/50 text-brand-green-800 dark:text-brand-green-300 text-sm font-medium shadow-sm">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-brand-green-400 opacity-75 animate-ping"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-brand-green-500"></span>
                  </span>
                  Join a growing community of verified users
                </div>

                <h1 className="font-display text-4xl sm:text-6xl font-bold tracking-tight text-foreground leading-[1.1] sm:leading-[1.1]">
                  Ready to join Mzansi&apos;s most{" "}
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-green-500 to-brand-gold-500">
                    trusted marketplace?
                  </span>
                </h1>

                <p className="text-muted-foreground text-lg sm:text-xl max-w-2xl mx-auto leading-relaxed">
                  Get verified in under 5 minutes. Buy, sell, and advertise with trust. Access three
                  connected marketplaces and reach customers across South Africa.
                </p>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
                  <Button
                    asChild
                    size="lg"
                    className="w-full sm:w-auto h-14 px-8 text-lg bg-brand-green hover:bg-brand-green-600 text-white shadow-[0_0_20px_-5px_rgba(0,131,62,0.4)] hover:shadow-[0_0_30px_-5px_rgba(0,131,62,0.6)] transition-all gap-2 rounded-full font-semibold"
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
                    className="w-full sm:w-auto h-14 px-8 text-lg border-warm-200 dark:border-warm-700 bg-white/50 dark:bg-warm-900/50 hover:bg-warm-50 dark:hover:bg-warm-800 rounded-full font-semibold backdrop-blur-sm transition-all"
                  >
                    <Link href="/pricing">View Plans</Link>
                  </Button>
                </div>

                <div className="pt-8 font-medium text-sm text-muted-foreground">
                  Already have an account?{" "}
                  <Link
                    href="/login"
                    className="text-foreground hover:text-brand-green transition-colors underline underline-offset-4"
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
