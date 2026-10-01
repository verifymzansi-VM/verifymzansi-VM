import type { Metadata } from "next";
import Link from "next/link";
import {
  BadgeCheck,
  BarChart3,
  Building2,
  Check,
  ChevronDown,
  Landmark,
  MessageCircle,
  Rocket,
  ShoppingBag,
  Sparkles,
  Star,
  TreePalm,
  User,
  Users,
  Video,
  X,
  Zap,
} from "lucide-react";
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { BrandSurface, VerificationEmblem, brandOutlineButtonClassName } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  ADDON_PRICES,
  BOOST_DURATION_DAYS,
  ENTERPRISE_ADMINS_INCLUDED,
  ENTERPRISE_QUOTE_ABOVE_SLOTS,
  FEATURED_DURATION_DAYS,
  SPONSOR_PROGRAMME_ADMINS,
  SPONSOR_PROGRAMME_PRICES,
  URGENT_DURATION_DAYS,
  formatPlanPrice,
} from "@/lib/constants/pricing";
import { getCommercialCatalog } from "@/lib/commercial/plans";
import { HELLO_CONTACT_EMAIL } from "@/lib/contact-email";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Advertise",
  description:
    "Advertise to local buyers on VerifyMzansi: individual posts from R50 for 30 days, multi-listing plans from 10 live slots, and programme partnerships that support local businesses.",
  alternates: { canonical: "https://verifymzansi.com/advertise" },
};

/** Prices come from the live catalogue; refresh every five minutes. */
export const revalidate = 300;

const PROPOSAL_HREF = "/contact?topic=organisation_proposal";

const AREAS = [
  {
    icon: ShoppingBag,
    tile: "area-market-tile",
    name: "Mzansi Market",
    body: "Sell to buyers near you: cars, phones, furniture.",
    href: "/post/create-listing",
    browse: "/mzansi-market",
  },
  {
    icon: Building2,
    tile: "area-business-tile",
    name: "Mzansi Business",
    body: "A profile customers can find: shops, trades, services.",
    href: "/post/create-business",
    browse: "/mzansi-business",
  },
  {
    icon: TreePalm,
    tile: "area-tourism-tile",
    name: "Tourism & Events",
    body: "Stays, tours, venues and free event listings.",
    href: "/post/create-tourism",
    browse: "/tourism-events",
  },
] as const;

const EXTRAS = [
  {
    icon: Rocket,
    name: "Boost",
    price: `${formatPlanPrice(ADDON_PRICES.boost)} for ${BOOST_DURATION_DAYS} days`,
    body: "Promoted placement in its section, clearly labelled.",
  },
  {
    icon: Star,
    name: "Featured",
    price: `${formatPlanPrice(ADDON_PRICES.featured)} for ${FEATURED_DURATION_DAYS} days`,
    body: "Featured label and placement. Not a stronger verification.",
  },
  {
    icon: Zap,
    name: "Urgent",
    price: `${formatPlanPrice(ADDON_PRICES.urgent)} for ${URGENT_DURATION_DAYS} days`,
    body: "A time-sensitive label. Not a safety endorsement.",
  },
  {
    icon: Sparkles,
    name: "Homepage spotlight",
    price: "With Boost or Featured",
    body: "Rotation on the homepage. No exclusive spot or guaranteed views.",
  },
] as const;

const CHECKS = {
  yes: [
    "Phone number confirmed",
    "SA ID or passport and a live selfie reviewed by our team",
    "Every post moderated before it goes live",
    "Badges show what was checked and when",
  ],
  no: [
    "We do not visit premises or inspect goods",
    "We do not check property, vehicles or quality",
    "We do not hold money or guarantee transactions",
    "“Supported by” is programme membership, not a verification",
  ],
} as const;

const PARTNER_INCLUDES = [
  "A branded programme showcase, searchable by category and area",
  "A “Supported by” label on each business, used only with written brand permission",
  "A place in the Programme partners strip and home page section",
  `Up to ${SPONSOR_PROGRAMME_ADMINS} named administrators who approve which businesses join`,
  "An activity summary every 30 days and a term-end report",
  "One remote onboarding session and one review meeting per 30 days",
] as const;

const STEPS = [
  { title: "Get verified", body: "Phone, ID and selfie. Once." },
  { title: "Create your post", body: "Photos and a short video." },
  { title: "Pick a plan", body: "30, 90 or 180 days. No automatic renewal." },
  { title: "Go live after review", body: "Every post is checked first." },
] as const;

const FAQ = [
  {
    q: "Is there a contract that renews automatically?",
    a: "No. Every plan is prepaid for a fixed number of days and ends on the date shown at checkout. Nothing is debited again unless you choose a new term.",
  },
  {
    q: "Can I cancel?",
    a: "Yes. You can cancel and receive a pro-rata refund for the unused part of your term. Your statutory cooling-off rights also apply.",
  },
  {
    q: "Do you take commission?",
    a: "No. Buyers and guests contact you directly by phone or WhatsApp. We never take a cut of a sale or booking.",
  },
  {
    q: "Does “Supported by” mean a business is verified?",
    a: "No. It means the business is part of an organisation’s programme. VerifyMzansi reviews every poster’s identity separately, and the label is not a safety or quality endorsement.",
  },
  {
    q: "Can sponsors claim B-BBEE or ESD points?",
    a: "Recognition is assessed by your own B-BBEE verification agency. We provide programme records and reports, but we cannot promise points.",
  },
] as const;

export default async function AdvertisePage() {
  const catalog = await getCommercialCatalog();
  const fromRetail = Math.min(...catalog.retail.map((offer) => offer.priceCents));
  const retailLadder = catalog.retail
    .map((offer) => `${formatPlanPrice(offer.priceCents)} / ${offer.durationDays} days`)
    .join(" · ");
  const smallest = [...catalog.enterprise].sort(
    (a, b) => a.slots - b.slots || a.priceCents - b.priceCents
  )[0];
  const largestSlots = Math.max(...catalog.enterprise.map((plan) => plan.slots), 0);
  const sponsorFrom = SPONSOR_PROGRAMME_PRICES[0]!;
  const sponsorMax = SPONSOR_PROGRAMME_PRICES[SPONSOR_PROGRAMME_PRICES.length - 1]!;

  const WAYS = [
    {
      icon: User,
      name: "Individual",
      who: "One thing to sell or one business profile.",
      price: `From ${formatPlanPrice(fromRetail)} / 30 days`,
      points: ["1 live slot in any section", retailLadder, "First post free for 7 days"],
      href: "/pricing",
      cta: "See individual plans",
    },
    {
      icon: Building2,
      name: "Multi-listing",
      who: "Dealers, agencies and shops with stock.",
      price: smallest
        ? `From ${formatPlanPrice(smallest.priceCents)} / ${smallest.durationDays} days`
        : "Quoted",
      points: [
        `${smallest?.slots ?? 10} to ${largestSlots || ENTERPRISE_QUOTE_ABOVE_SLOTS} live slots, 90 or 180 days`,
        `${ENTERPRISE_ADMINS_INCLUDED} named administrators`,
        `Above ${ENTERPRISE_QUOTE_ABOVE_SLOTS} slots: written quote`,
      ],
      href: "/pricing#enterprise",
      cta: "See multi-listing prices",
    },
    {
      icon: Landmark,
      name: "Programme partner",
      who: "Organisations that support local businesses.",
      price: `From ${formatPlanPrice(sponsorFrom.price90Cents)} / 90 days`,
      points: [
        `Support ${sponsorFrom.capacity} to ${sponsorMax.capacity} businesses`,
        "Branded showcase and Supported-by label",
        "Activity summary every 30 days",
      ],
      href: "#programmes",
      cta: "See programme options",
    },
  ] as const;

  return (
    <>
      <Header />
      <main id="main-content" className="min-h-screen scroll-mt-24 bg-background">
        {/* 1 ── Hero ─────────────────────────────────────────── */}
        <BrandSurface as="section" aria-labelledby="advertise-title">
          <div className="container-page grid items-center gap-10 pb-10 pt-6 sm:pt-8 lg:grid-cols-[minmax(0,1.1fr)_auto] lg:gap-14 lg:pb-16 lg:pt-10">
            <div className="min-w-0">
              <Breadcrumbs items={[{ label: "Advertise" }]} tone="inverse" />
              <h1
                id="advertise-title"
                className="mt-4 font-display text-[2.1rem] font-extrabold leading-[1.06] tracking-[-0.03em] text-white sm:text-5xl"
              >
                Get seen by local buyers who{" "}
                <span className="text-brand-gold-300">know who they are dealing with.</span>
              </h1>
              <p className="mt-4 max-w-xl text-base leading-7 text-white/75 sm:text-lg sm:leading-8">
                Every poster&rsquo;s identity is reviewed before their posts go live.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Button
                  asChild
                  size="lg"
                  variant="trust-verified"
                  className="h-12 rounded-full px-6"
                >
                  <Link href="/post/create">Post for free</Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className={cn("h-12 rounded-full px-6", brandOutlineButtonClassName)}
                >
                  <Link href="/pricing">See plans</Link>
                </Button>
              </div>
              <ul className="mt-6 flex flex-wrap gap-2 text-sm text-white/85">
                {[
                  { icon: BadgeCheck, text: "Identity reviewed" },
                  { icon: Video, text: "Video-first posts" },
                  { icon: MessageCircle, text: "Direct contact, no commission" },
                ].map(({ icon: Icon, text }) => (
                  <li
                    key={text}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5"
                  >
                    <Icon aria-hidden="true" className="h-4 w-4 text-brand-gold-300" />
                    {text}
                  </li>
                ))}
              </ul>
            </div>
            <div className="hidden lg:block">
              <VerificationEmblem size="md" />
            </div>
          </div>
        </BrandSurface>

        {/* 2 ── Three ways to advertise ─────────────────────── */}
        <section aria-labelledby="advertise-ways-title" className="container-page py-12 sm:py-16">
          <h2 id="advertise-ways-title" className="section-title">
            Three ways to advertise
          </h2>
          <div className="mt-7 grid gap-4 lg:grid-cols-3">
            {WAYS.map(({ icon: Icon, name, who, price, points, href, cta }) => (
              <article
                key={name}
                className="flex flex-col rounded-3xl border border-border/70 bg-card p-5 elev-xs sm:p-6"
              >
                <span className="icon-tile h-11 w-11 rounded-2xl area-business-tile">
                  <Icon aria-hidden="true" className="h-5 w-5" />
                </span>
                <h3 className="mt-4 font-display text-xl font-bold text-foreground">{name}</h3>
                <p className="text-sm text-muted-foreground">{who}</p>
                <p className="mt-3 font-display text-2xl font-extrabold tracking-tight text-foreground">
                  {price}
                </p>
                <ul className="mt-4 flex-1 space-y-2 border-t border-border/60 pt-4 text-sm">
                  {points.map((point) => (
                    <li key={point} className="flex gap-2">
                      <Check
                        aria-hidden="true"
                        className="mt-0.5 h-4 w-4 shrink-0 text-brand-green-600 dark:text-brand-green-400"
                      />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
                <Button asChild variant="outline" className="mt-5 h-11 w-full rounded-full">
                  <Link href={href}>{cta}</Link>
                </Button>
              </article>
            ))}
          </div>
        </section>

        {/* 3 ── Where your post appears ─────────────────────── */}
        <section
          aria-labelledby="advertise-areas-title"
          className="border-y border-border/60 bg-card/50"
        >
          <div className="container-page py-12 sm:py-16">
            <h2 id="advertise-areas-title" className="section-title">
              Where your post appears
            </h2>
            <ul className="mt-7 grid gap-4 md:grid-cols-3">
              {AREAS.map(({ icon: Icon, tile, name, body, href, browse }) => (
                <li
                  key={name}
                  className="flex flex-col rounded-2xl border border-border/70 bg-background p-5"
                >
                  <div className="flex items-center gap-3">
                    <span className={cn("icon-tile h-11 w-11 rounded-2xl", tile)}>
                      <Icon aria-hidden="true" className="h-5 w-5" />
                    </span>
                    <h3 className="font-display text-lg font-bold text-foreground">{name}</h3>
                  </div>
                  <p className="mt-3 flex-1 text-sm leading-6 text-muted-foreground">{body}</p>
                  <div className="mt-4 flex flex-wrap gap-x-4">
                    <Link
                      href={href}
                      className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-green-700 underline-offset-4 hover:underline dark:text-brand-green-300"
                    >
                      Post here
                    </Link>
                    <Link
                      href={browse}
                      className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      Browse {name}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 4 ── What we check, and what we don't ─────────────── */}
        <section aria-labelledby="advertise-checks-title" className="container-page py-12 sm:py-16">
          <h2 id="advertise-checks-title" className="section-title">
            What we check — and what we don&rsquo;t
          </h2>
          <div className="mt-7 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-brand-green/30 bg-brand-green/[0.05] p-5">
              <h3 className="font-semibold text-foreground">We check</h3>
              <ul className="mt-3 space-y-2 text-sm">
                {CHECKS.yes.map((text) => (
                  <li key={text} className="flex gap-2">
                    <Check
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0 text-brand-green-600 dark:text-brand-green-400"
                    />
                    {text}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-border/70 p-5">
              <h3 className="font-semibold text-foreground">We don&rsquo;t</h3>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                {CHECKS.no.map((text) => (
                  <li key={text} className="flex gap-2">
                    <X aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                    {text}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <Link
            href="/trust-safety"
            className="mt-4 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
          >
            What each badge means
          </Link>
        </section>

        {/* 5 ── Get more eyes on a post ─────────────────────── */}
        <section
          aria-labelledby="advertise-extras-title"
          className="border-y border-border/60 bg-card/50"
        >
          <div className="container-page py-12 sm:py-16">
            <h2 id="advertise-extras-title" className="section-title">
              Get more eyes on a post
            </h2>
            <p className="section-lede">
              Optional, clearly labelled and still moderated. No guaranteed number of views.
            </p>
            <ul className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {EXTRAS.map(({ icon: Icon, name, price, body }) => (
                <li key={name} className="surface-card flex gap-4 p-4 sm:flex-col sm:gap-0 sm:p-5">
                  <span className="icon-tile h-11 w-11 bg-brand-gold/20 text-brand-gold-800 dark:bg-brand-gold/15 dark:text-brand-gold-300">
                    <Icon aria-hidden="true" className="h-5 w-5" />
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

        {/* 6 ── Programme partners ──────────────────────────── */}
        <section
          id="programmes"
          aria-labelledby="advertise-programmes-title"
          className="container-page scroll-mt-24 py-12 sm:py-16"
        >
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-green-700 dark:text-brand-green-300">
                For organisations
              </p>
              <h2 id="advertise-programmes-title" className="section-title mt-2">
                Become a programme partner
              </h2>
              <p className="section-lede">
                For chambers, municipalities, enterprise-development programmes and companies that
                support local businesses and need to show where the support went.
              </p>
              <h3 className="mt-6 font-semibold text-foreground">What a partner gets</h3>
              <ul className="mt-3 space-y-2 text-sm">
                {PARTNER_INCLUDES.map((text) => (
                  <li key={text} className="flex gap-2">
                    <Check
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0 text-brand-green-600 dark:text-brand-green-400"
                    />
                    {text}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm text-muted-foreground">
                Not included: site visits, on-site verification, professional filming, travel or any
                promise of views, enquiries, sales or B-BBEE recognition.
              </p>
            </div>
            <div className="min-w-0 space-y-4">
              <div className="overflow-hidden rounded-2xl border border-border/70">
                <table className="w-full text-sm">
                  <caption className="bg-muted/60 px-4 py-3 text-left font-semibold text-foreground">
                    Programme fee (total for the term)
                  </caption>
                  <thead>
                    <tr className="border-t border-border/60 text-left text-muted-foreground">
                      <th scope="col" className="px-4 py-2 font-medium">
                        Businesses
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        90 days
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        180 days
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {SPONSOR_PROGRAMME_PRICES.map((row) => (
                      <tr key={row.capacity} className="border-t border-border/60">
                        <th scope="row" className="px-4 py-2.5 text-left font-semibold">
                          Up to {row.capacity}
                        </th>
                        <td className="px-4 py-2.5 tabular-nums">
                          {formatPlanPrice(row.price90Cents)}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums">
                          {formatPlanPrice(row.price180Cents)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t border-border/60">
                      <th scope="row" className="px-4 py-2.5 text-left font-semibold">
                        More than {sponsorMax.capacity}
                      </th>
                      <td colSpan={2} className="px-4 py-2.5 text-muted-foreground">
                        Custom proposal
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="rounded-2xl border border-brand-gold/40 bg-brand-gold/10 p-4 text-sm">
                <p className="font-semibold text-foreground">Founding pilots</p>
                <p className="mt-1 text-muted-foreground">
                  3 programmes in the City of uMhlathuze, up to 25 businesses each, free for 90
                  days. Invitations close on 31 December 2026. Nothing renews or charges
                  automatically.
                </p>
              </div>
              <Button asChild variant="ink" className="h-11 w-full rounded-full sm:w-auto">
                <Link href={PROPOSAL_HREF}>Request a programme proposal</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* 7 ── Sample report ───────────────────────────────── */}
        <section
          aria-labelledby="advertise-report-title"
          className="border-y border-border/60 bg-card/50"
        >
          <div className="container-page py-12 sm:py-16">
            <h2 id="advertise-report-title" className="section-title">
              What a partner report looks like
            </h2>
            <figure className="mt-7 max-w-3xl rounded-2xl border border-border/70 bg-background p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 font-semibold">
                  <BarChart3 aria-hidden="true" className="h-5 w-5 text-brand-green-600" />
                  30-day activity summary
                </p>
                <span className="rounded-full bg-brand-gold/20 px-2.5 py-1 text-xs font-bold text-brand-gold-900 dark:text-brand-gold-200">
                  Example — not real results
                </span>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Businesses activated", "21 of 25"],
                  ["Live profiles", "19"],
                  ["Profile views", "1,240"],
                  ["Unique contact clicks", "86"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-muted/60 p-3">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="font-display text-xl font-bold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
              <figcaption className="mt-4 text-xs leading-5 text-muted-foreground">
                Known limitations: views and clicks are counted on VerifyMzansi only. A click on
                &ldquo;Call&rdquo; or &ldquo;WhatsApp&rdquo; is not a confirmed enquiry or sale, and
                visitors who block tracking are not counted.
              </figcaption>
            </figure>
          </div>
        </section>

        {/* 8 ── How it works ────────────────────────────────── */}
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

        {/* 9 ── FAQ ─────────────────────────────────────────── */}
        <section aria-labelledby="advertise-faq-title" className="container-page pb-12 sm:pb-16">
          <h2 id="advertise-faq-title" className="section-title">
            Questions
          </h2>
          <div className="mt-6 max-w-3xl divide-y divide-border/60 rounded-2xl border border-border/70">
            {FAQ.map(({ q, a }) => (
              <details key={q} className="group">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                  {q}
                  <ChevronDown
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
                  />
                </summary>
                <p className="px-4 pb-4 text-sm leading-6 text-muted-foreground">{a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* 10 ── Final call to action ───────────────────────── */}
        <BrandSurface as="section" aria-labelledby="advertise-final-title">
          <div className="container-page flex flex-col gap-6 py-12 sm:py-14 md:flex-row md:items-center md:justify-between">
            <div className="max-w-xl">
              <h2
                id="advertise-final-title"
                className="font-display text-3xl font-extrabold tracking-tight text-white"
              >
                Ready when you are.
              </h2>
              <p className="mt-2 text-white/75">
                Your first post is free for 7 days. Organisations can email{" "}
                <a
                  className="font-semibold text-brand-gold-300 underline-offset-4 hover:underline"
                  href={`mailto:${HELLO_CONTACT_EMAIL}`}
                >
                  {HELLO_CONTACT_EMAIL}
                </a>
                .
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" variant="trust-verified" className="h-12 rounded-full px-6">
                <Link href="/post/create">Post for free</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className={cn("h-12 rounded-full px-6", brandOutlineButtonClassName)}
              >
                <Link href={PROPOSAL_HREF}>
                  <Users aria-hidden="true" className="mr-1.5 h-4 w-4" />
                  Talk to us about a programme
                </Link>
              </Button>
            </div>
          </div>
        </BrandSurface>
      </main>
      <Footer />
    </>
  );
}
