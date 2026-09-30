import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Building2, Rocket, ShoppingBag, Sparkles, Star, TreePalm, Zap } from "lucide-react";
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { BRAND_SHIELD_SRC, BrandSurface, brandOutlineButtonClassName } from "@/components/brand";
import { TrustStrip } from "@/components/layout/trust-strip";
import { Button } from "@/components/ui/button";
import { VerifiedTick } from "@/components/trust/verified-tick";
import {
  ADDON_PRICES,
  BOOST_DURATION_DAYS,
  FEATURED_DURATION_DAYS,
  URGENT_DURATION_DAYS,
  formatPlanPrice,
} from "@/lib/constants/pricing";
import { VERIFY_MZANSI_CATEGORY_SEO } from "@/lib/seo/public-categories";
import { cn } from "@/lib/utils";

type AdvertiseSurface = {
  name: string;
  description: string;
  browseHref: string;
  createHref: string;
  createLabel: string;
  secondaryCreateHref?: string;
  secondaryCreateLabel?: string;
};

export const metadata: Metadata = {
  title: "Advertise",
  description:
    "Advertise marketplace items, business services, tourism accommodation, experiences, venues, and events on VerifyMzansi.",
  alternates: {
    canonical: "https://verifymzansi.com/advertise",
  },
};

const AREA_STYLE: Record<
  string,
  { icon: typeof ShoppingBag; tile: string; button: string; bestFor: string; examples: string[] }
> = {
  "mzansi-market": {
    icon: ShoppingBag,
    tile: "area-market-tile",
    button:
      "bg-brand-green-600 text-white hover:bg-brand-green-700 dark:bg-brand-green-500 dark:text-brand-green-950 dark:hover:bg-brand-green-400",
    bestFor: "Sell to buyers near you.",
    examples: ["Cars & bakkies", "Phones", "Furniture"],
  },
  "mzansi-business": {
    icon: Building2,
    tile: "area-business-tile",
    button:
      "bg-brand-blue-600 text-white hover:bg-brand-blue-700 dark:bg-brand-blue-500 dark:hover:bg-brand-blue-400",
    bestFor: "A profile customers can find.",
    examples: ["Shops", "Trades", "Services"],
  },
  "tourism-events": {
    icon: TreePalm,
    tile: "area-tourism-tile",
    button:
      "bg-sunset-600 text-white hover:bg-sunset-700 dark:bg-sunset-500 dark:hover:bg-sunset-400",
    bestFor: "Get booked and fill events.",
    examples: ["Stays", "Tours & venues", "Free events"],
  },
};

const EXTRAS = [
  {
    icon: Rocket,
    name: "Boost",
    price: `${formatPlanPrice(ADDON_PRICES.boost)} for ${BOOST_DURATION_DAYS} days`,
    body: "Top of its section.",
    tile: "bg-brand-green/10 text-brand-green-700 dark:bg-brand-green/15 dark:text-brand-green-300",
  },
  {
    icon: Star,
    name: "Featured",
    price: `${formatPlanPrice(ADDON_PRICES.featured)} for ${FEATURED_DURATION_DAYS} days`,
    body: "Gold badge and featured placement.",
    tile: "bg-brand-gold/20 text-brand-gold-800 dark:bg-brand-gold/15 dark:text-brand-gold-300",
  },
  {
    icon: Zap,
    name: "Urgent badge",
    price: `${formatPlanPrice(ADDON_PRICES.urgent)} for ${URGENT_DURATION_DAYS} days`,
    body: "Red badge for time-sensitive deals.",
    tile: "bg-brand-red/10 text-brand-red-700 dark:bg-brand-red/15 dark:text-brand-red-300",
  },
  {
    icon: Sparkles,
    name: "Spotlight showroom",
    price: "With Boost or Featured",
    body: "Shown first on the homepage.",
    tile: "bg-brand-blue/10 text-brand-blue-700 dark:bg-brand-blue/20 dark:text-brand-blue-300",
  },
] as const;

const STEPS = [
  {
    title: "Get verified",
    body: "Phone, ID, selfie and location. Once.",
  },
  {
    title: "Create your post",
    body: "Your first one is free.",
  },
  {
    title: "Pick a plan",
    body: "30 days to 12 months, plus extras.",
  },
  {
    title: "Go live after review",
    body: "Every post is checked first.",
  },
] as const;

export default function AdvertisePage() {
  const surfaces: (AdvertiseSurface & { id: string })[] = VERIFY_MZANSI_CATEGORY_SEO.map(
    (category) => {
      if (category.id === "mzansi-market") {
        return {
          id: category.id,
          name: category.name,
          description: category.description,
          browseHref: category.href,
          createHref: "/post/create-listing",
          createLabel: "Create marketplace listing",
        };
      }

      if (category.id === "mzansi-business") {
        return {
          id: category.id,
          name: category.name,
          description: category.description,
          browseHref: category.href,
          createHref: "/post/create-business",
          createLabel: "Create business profile",
        };
      }

      return {
        id: category.id,
        name: category.name,
        description: category.description,
        browseHref: category.href,
        createHref: "/post/create-tourism",
        createLabel: "List tourism business",
        secondaryCreateHref: "/post/create-tourism?type=event",
        secondaryCreateLabel: "Create event",
      };
    }
  );

  return (
    <>
      <Header />
      <main id="main-content" className="min-h-screen scroll-mt-24 bg-background">
        {/* ── Hero ─────────────────────────────────────────── */}
        <BrandSurface as="section" aria-labelledby="advertise-title">
          <div className="container-page relative grid items-center gap-10 pb-10 pt-6 sm:pt-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-14 lg:pb-16 lg:pt-10">
            <div className="min-w-0">
              <Breadcrumbs items={[{ label: "Advertise" }]} tone="inverse" />
              <h1
                id="advertise-title"
                className="mt-4 font-display text-[2.2rem] font-extrabold leading-[1.05] tracking-[-0.03em] text-white sm:text-5xl"
              >
                Advertise on <span className="text-brand-gold-300">VerifyMzansi</span>
              </h1>
              <p className="mt-4 max-w-xl text-base leading-7 text-white/75 sm:text-lg sm:leading-8">
                Reach buyers, customers and guests on a marketplace where every poster is
                ID-reviewed.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Button
                  asChild
                  size="lg"
                  variant="trust-verified"
                  className="h-12 rounded-full px-6"
                >
                  <Link href="/post/create">Choose a post type</Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className={cn("h-12 rounded-full px-6", brandOutlineButtonClassName)}
                >
                  <Link href="/pricing">View pricing</Link>
                </Button>
              </div>
              <p className="mt-4 text-sm text-white/65">First post free. Plans from R50.</p>
            </div>

            {/* Visual: a post with the extras applied */}
            <div
              className="relative mx-auto hidden w-full max-w-[440px] lg:block"
              aria-hidden="true"
            >
              <div className="overflow-hidden rounded-[28px] border border-white/10 bg-card shadow-2xl">
                <div className="relative flex aspect-[4/3] items-center justify-center bg-gradient-to-br from-brand-green-700 via-brand-green-800 to-brand-green-900">
                  <div className="mzansi-pattern absolute inset-0 opacity-[0.08] invert" />
                  <div className="absolute h-40 w-40 rounded-full bg-brand-gold-400/25 blur-3xl" />
                  <Image
                    src={BRAND_SHIELD_SRC}
                    alt=""
                    width={144}
                    height={144}
                    sizes="144px"
                    priority
                    className="relative h-36 w-36 object-contain drop-shadow-[0_18px_40px_rgba(0,0,0,0.45)]"
                  />
                  <div className="absolute left-3 top-3 flex gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-gold px-2.5 py-1 text-xs font-bold text-brand-gold-950 shadow-sm">
                      <Star className="h-3.5 w-3.5 fill-current" />
                      Featured
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-red-600 px-2.5 py-1 text-xs font-bold text-white shadow-sm">
                      <Zap className="h-3.5 w-3.5 fill-current" />
                      Urgent
                    </span>
                  </div>
                </div>
                <div className="space-y-2 p-5">
                  <p className="font-display text-xl font-bold text-foreground">
                    Your post, seen first
                  </p>
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <VerifiedTick decorative className="h-4 w-4" />
                    Posted by an ID-reviewed member
                  </p>
                </div>
              </div>
              <div className="absolute -right-6 top-[52%] flex items-center gap-3 rounded-2xl border border-border/70 bg-card px-4 py-3 shadow-xl">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-green-600 text-white">
                  <Rocket className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-bold text-foreground">Boosted to the top</p>
                  <p className="text-xs text-muted-foreground">For {BOOST_DURATION_DAYS} days</p>
                </div>
              </div>
            </div>
          </div>
        </BrandSurface>

        <TrustStrip variant="green" title="Trusted posting categories" />

        {/* ── Where to advertise ───────────────────────────── */}
        <section aria-labelledby="advertise-areas-title" className="container-page py-12 sm:py-16">
          <h2 id="advertise-areas-title" className="section-title">
            Choose where to post
          </h2>
          <div className="mt-7 grid gap-4 lg:grid-cols-3">
            {surfaces.map((surface) => {
              const style = AREA_STYLE[surface.id] ?? AREA_STYLE["mzansi-market"];
              const Icon = style.icon;
              return (
                <article
                  key={surface.name}
                  className="flex flex-col rounded-3xl border border-border/70 bg-card p-5 elev-xs sm:p-6"
                >
                  <div className="flex items-center gap-3">
                    <span className={cn("icon-tile h-12 w-12 rounded-2xl", style.tile)}>
                      <Icon className="h-6 w-6" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-display text-xl font-bold text-foreground">
                        {surface.name}
                      </h3>
                      <p className="text-sm text-muted-foreground">{style.bestFor}</p>
                    </div>
                  </div>
                  <ul className="mt-4 flex flex-1 flex-wrap content-start gap-2">
                    {style.examples.map((example) => (
                      <li key={example} className="chip">
                        {example}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-5 flex flex-col gap-2">
                    <Button asChild className={cn("h-11 w-full rounded-full", style.button)}>
                      <Link href={surface.createHref}>{surface.createLabel}</Link>
                    </Button>
                    {surface.secondaryCreateHref && surface.secondaryCreateLabel ? (
                      <Button asChild variant="outline" className="h-11 w-full rounded-full">
                        <Link href={surface.secondaryCreateHref}>
                          {surface.secondaryCreateLabel}
                        </Link>
                      </Button>
                    ) : null}
                    <Link
                      href={surface.browseHref}
                      className="inline-flex min-h-11 items-center justify-center rounded-full text-sm font-semibold text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {surface.name === "Tourism & Events"
                        ? "Explore Tourism & Events"
                        : `Browse ${surface.name}`}
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* ── Extras ───────────────────────────────────────── */}
        <section
          aria-labelledby="advertise-extras-title"
          className="border-y border-border/60 bg-card/50"
        >
          <div className="container-page py-12 sm:py-16">
            <h2 id="advertise-extras-title" className="section-title">
              Get more eyes on your post
            </h2>
            <p className="section-lede">For posts on a paid plan. Still moderated.</p>
            <ul className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {EXTRAS.map(({ icon: Icon, name, price, body, tile }) => (
                <li key={name} className="surface-card flex gap-4 p-4 sm:flex-col sm:gap-0 sm:p-5">
                  <span className={cn("icon-tile h-11 w-11", tile)}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-body text-base font-bold text-foreground sm:mt-4">
                      {name}
                    </h3>
                    <p className="mt-0.5 text-sm font-semibold text-brand-green-700 dark:text-brand-green-300">
                      {price}
                    </p>
                    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── How it works (a real sequence) ───────────────── */}
        <section aria-labelledby="advertise-steps-title" className="container-page py-12 sm:py-16">
          <h2 id="advertise-steps-title" className="section-title">
            How it works
          </h2>
          <ol className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <li
                key={step.title}
                className="flex gap-4 rounded-2xl border border-border/70 p-4 sm:flex-col sm:gap-0 sm:p-5"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground font-display text-sm font-bold text-background">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <h3 className="font-body text-base font-bold text-foreground sm:mt-4">
                    {step.title}
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Organisations ────────────────────────────────── */}
        <section aria-labelledby="advertise-org-title" className="container-page pb-14 sm:pb-20">
          <div className="flex flex-col gap-5 rounded-3xl bg-muted/70 p-6 sm:p-8 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl">
              <h2
                id="advertise-org-title"
                className="font-display text-2xl font-bold tracking-tight text-foreground"
              >
                Advertising for a brand or group?
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground sm:text-base">
                Bulk slots and sponsored programmes.
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
              <Button asChild variant="ink" className="h-11 rounded-full px-5">
                <Link href="/contact?topic=organisation_proposal">Request a proposal</Link>
              </Button>
              <Button asChild variant="outline" className="h-11 rounded-full px-5">
                <Link href="/pricing#enterprise">See organisation plans</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
