import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Building2,
  Check,
  Clapperboard,
  ChevronDown,
  Eye,
  Landmark,
  MessageCircle,
  Mic,
  Rocket,
  ShoppingBag,
  Sparkles,
  Star,
  Timer,
  TreePalm,
  User,
  Users,
  Video,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Reveal } from "@/components/marketing/reveal";
import { SpotlightCard } from "@/components/marketing/spotlight-card";
import { VideoShowcase } from "@/components/marketing/video-showcase";
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
    "Why advertise on VerifyMzansi, and which package fits: individual posts, multi-listing for dealers and agencies, and programme partnerships that support local businesses.",
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
    "Stickers show what was checked and when: ID reviewed, CIPC registered, Seen by VerifyMzansi",
  ],
  no: [
    "We only visit a business (in person or on live video) if it asks for the Seen sticker",
    "We do not check property, vehicles or quality",
    "We do not hold money or guarantee transactions",
    "“Supported by” is programme membership, not a verification",
  ],
} as const;

const BENEFITS = [
  {
    icon: BadgeCheck,
    title: "Buyers can see you are real",
    body: "Your phone, ID and a live selfie are reviewed before you go live. Buyers who are wary of scams look for exactly that.",
  },
  {
    icon: Video,
    title: "Show it, don’t just say it",
    body: "Photos and a short video let people see what you sell or offer before they call.",
  },
  {
    icon: MessageCircle,
    title: "Keep every rand",
    body: "Buyers and guests contact you directly by phone or WhatsApp. We never take a cut of a sale or booking.",
  },
  {
    icon: Timer,
    title: "No lock-in",
    body: "Plans run for a fixed number of days and never renew by themselves. You choose whether to go again.",
  },
] as const;

const VIDEO_POINTS = [
  {
    icon: Eye,
    title: "Show the real thing",
    body: "Walk around the car, the room or the stall. Condition and detail are clear in seconds.",
  },
  {
    icon: Mic,
    title: "Let buyers meet you",
    body: "A few seconds of your own voice and face builds trust that text alone can’t.",
  },
  {
    icon: Clapperboard,
    title: "Stand out in the listings",
    body: "Posts with video catch the eye, and the identity badge tells buyers who is behind it.",
  },
] as const;

interface PackageDetail {
  id: "individual" | "multi-listing" | "programmes";
  icon: LucideIcon;
  name: string;
  eyebrow: string;
  title: string;
  lede: string;
  /** Short line for the chooser cards. */
  who: string;
  audience: readonly string[];
  includes: readonly string[];
  notIncluded: string;
  pricesHref: string;
  pricesLabel: string;
  cta: { href: string; label: string };
}

const PACKAGES: readonly PackageDetail[] = [
  {
    id: "individual",
    icon: User,
    name: "Individual",
    eyebrow: "For one post or one business",
    title: "Sell something, or put your business on the map",
    lede: "One live slot, in any section. The simplest way to reach local buyers with a post people can trust.",
    who: "Anyone selling one thing or running one business profile.",
    audience: [
      "Private sellers: a car, phone, furniture or equipment",
      "Tradespeople, freelancers and shop owners who need one business profile",
      "Guesthouses, tour guides and venues with one tourism listing",
      "Community groups sharing an event (events are always free)",
    ],
    includes: [
      "1 live slot in Mzansi Market, Mzansi Business or Tourism & Events",
      "An ID reviewed sticker, plus optional CIPC registered and Seen stickers for businesses",
      "Photos and a short video on your post",
      "Calls and WhatsApp straight to you, with no commission",
      "Your first post free for 7 days once your ID is reviewed, then 30, 90 or 180 days",
      "Reuse the slot when something sells or you take a post down",
    ],
    notIncluded: "Not included: guaranteed views, enquiries or sales.",
    pricesHref: "/pricing#plans",
    pricesLabel: "See individual prices",
    cta: { href: "/post/create", label: "Post for free" },
  },
  {
    id: "multi-listing",
    icon: Building2,
    name: "Multi-listing",
    eyebrow: "For dealers, agencies and shops with stock",
    title: "List everything you have, from one account",
    lede: `From 10 up to ${ENTERPRISE_QUOTE_ABOVE_SLOTS} live slots at once and ${ENTERPRISE_ADMINS_INCLUDED} named administrators, so your whole stock is in front of buyers together.`,
    who: "Dealers, agencies, shops and landlords with several things to list.",
    audience: [
      "Car, bike and equipment dealers",
      "Estate agencies, landlords and property managers",
      "Shops and traders with a large or changing stock",
      "Lodges, tour operators and venues with many units or offerings",
    ],
    includes: [
      `10 to ${ENTERPRISE_QUOTE_ABOVE_SLOTS} live slots at the same time, across every section`,
      "90 or 180 day terms with a fixed end date",
      `${ENTERPRISE_ADMINS_INCLUDED} named administrators to manage posts`,
      "Every poster and post still identity-reviewed and moderated",
      "Swap stock in and out as items sell",
      `More than ${ENTERPRISE_QUOTE_ABOVE_SLOTS} slots: a written quote`,
    ],
    notIncluded: "Not included: guaranteed views, enquiries or sales.",
    pricesHref: "/pricing#multi-listing-prices",
    pricesLabel: "See multi-listing prices",
    cta: { href: PROPOSAL_HREF, label: "Request a proposal" },
  },
  {
    id: "programmes",
    icon: Landmark,
    name: "Programme partner",
    eyebrow: "For organisations",
    title: "Become a programme partner",
    lede: "For chambers, municipalities, enterprise-development programmes and companies that support local businesses and need to show where the support went.",
    who: "Chambers, municipalities, development programmes and companies that support local businesses.",
    audience: [
      "Chambers of commerce and business associations",
      "Municipalities and local economic development units",
      "Enterprise and supplier development programmes",
      "Companies and funders backing local businesses",
    ],
    includes: [
      "A branded programme showcase, searchable by category and area",
      "A “Supported by” label on each business, used only with written brand permission",
      "A place in the Programme partners strip and home page section",
      `Up to ${SPONSOR_PROGRAMME_ADMINS} named administrators who approve which businesses join`,
      "An activity summary every 30 days and a term-end report",
      "One remote onboarding session and one review meeting per 30 days",
    ],
    notIncluded:
      "Not included: site visits, on-site verification, professional filming, travel or any promise of views, enquiries, sales or B-BBEE recognition.",
    pricesHref: "/pricing#programme-prices",
    pricesLabel: "See programme fees",
    cta: { href: PROPOSAL_HREF, label: "Request a programme proposal" },
  },
];

interface PriceSheetData {
  caption: string;
  columns: readonly string[];
  rows: ReadonlyArray<{ label: string; cells: readonly string[]; note?: string }>;
  footnote?: string;
}

function PriceSheet({ caption, columns, rows, footnote }: PriceSheetData) {
  return (
    <div>
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-background">
        <table className="w-full text-sm">
          <caption className="bg-muted/60 px-4 py-3 text-left font-semibold text-foreground">
            {caption}
          </caption>
          <thead>
            <tr className="border-t border-border/60 text-left text-muted-foreground">
              {columns.map((column) => (
                <th key={column} scope="col" className="px-4 py-2 font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-border/60">
                <th scope="row" className="px-4 py-2.5 text-left font-semibold">
                  {row.label}
                </th>
                {row.cells.length === 1 ? (
                  <td colSpan={columns.length - 1} className="px-4 py-2.5 text-muted-foreground">
                    {row.cells[0]}
                  </td>
                ) : (
                  row.cells.map((cell, index) => (
                    <td key={index} className="px-4 py-2.5 tabular-nums">
                      {cell}
                    </td>
                  ))
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footnote ? <p className="mt-2 text-xs text-muted-foreground">{footnote}</p> : null}
    </div>
  );
}

function PackageSection({
  pkg,
  sheet,
  shaded,
  children,
}: {
  pkg: PackageDetail;
  sheet: PriceSheetData;
  shaded: boolean;
  children?: ReactNode;
}) {
  const { id, icon: Icon, eyebrow, title, lede, audience, includes, notIncluded } = pkg;
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn("scroll-mt-24", shaded && "border-y border-border/60 bg-card/50")}
    >
      <div className="container-page grid gap-8 py-12 sm:py-16 lg:grid-cols-2 lg:gap-12">
        <Reveal>
          <span className="icon-tile h-11 w-11 rounded-2xl area-business-tile">
            <Icon aria-hidden="true" className="h-5 w-5" />
          </span>
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.14em] text-brand-green-700 dark:text-brand-green-300">
            {eyebrow}
          </p>
          <h2 id={`${id}-title`} className="section-title mt-2">
            {title}
          </h2>
          <p className="section-lede">{lede}</p>
          <h3 className="mt-6 font-semibold text-foreground">What you get</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {includes.map((text) => (
              <li key={text} className="flex gap-2">
                <Check
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 text-brand-green-600 dark:text-brand-green-400"
                />
                {text}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted-foreground">{notIncluded}</p>
        </Reveal>
        <Reveal delay={120} className="min-w-0 space-y-4">
          <PriceSheet {...sheet} />
          <div className="rounded-2xl border border-border/70 bg-background p-5">
            <h3 className="font-semibold text-foreground">Who can use it</h3>
            <ul className="mt-3 space-y-2.5 text-sm">
              {audience.map((text) => (
                <li key={text} className="flex gap-2.5">
                  <BadgeCheck
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-4 shrink-0 text-brand-gold-700 dark:text-brand-gold-300"
                  />
                  {text}
                </li>
              ))}
            </ul>
          </div>
          {children}
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button asChild variant="ink" className="h-11 rounded-full">
              <Link href={pkg.cta.href}>{pkg.cta.label}</Link>
            </Button>
            <Button asChild variant="outline" className="h-11 rounded-full">
              <Link href={pkg.pricesHref}>{pkg.pricesLabel}</Link>
            </Button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

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
    a: "Yes, you can take your post down at any time. Unused days are not refunded automatically; we refund rejected posts, duplicate charges and billing errors, and your statutory cooling-off rights apply.",
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
  const retail = [...catalog.retail].sort((a, b) => a.durationDays - b.durationDays);
  const slotSizes = [...new Set(catalog.enterprise.map((plan) => plan.slots))].sort(
    (a, b) => a - b
  );
  const enterprisePrice = (slots: number, days: number) => {
    const plan = catalog.enterprise.find((p) => p.slots === slots && p.durationDays === days);
    return plan ? formatPlanPrice(plan.priceCents) : "—";
  };
  const sponsorMax = SPONSOR_PROGRAMME_PRICES[SPONSOR_PROGRAMME_PRICES.length - 1]!;

  const sheets: Record<PackageDetail["id"], PriceSheetData> = {
    individual: {
      caption: "Individual plans (one live slot)",
      columns: ["Term", "Price"],
      rows: [
        ...retail.map((offer) => ({
          label: `${offer.durationDays} days`,
          cells: [formatPlanPrice(offer.priceCents)],
        })),
        { label: "Events", cells: ["Always free"] },
      ],
      footnote: "The same price in every section. Your first post is free for 7 days.",
    },
    "multi-listing": {
      caption: "Multi-listing price (total for the term)",
      columns: ["Live slots", "90 days", "180 days"],
      rows: [
        ...slotSizes.map((slots) => ({
          label: `${slots} slots`,
          cells: [enterprisePrice(slots, 90), enterprisePrice(slots, 180)],
        })),
        {
          label: `More than ${ENTERPRISE_QUOTE_ABOVE_SLOTS}`,
          cells: ["Written quote"],
        },
      ],
      footnote: `${ENTERPRISE_ADMINS_INCLUDED} named administrators included.`,
    },
    programmes: {
      caption: "Programme fee (total for the term)",
      columns: ["Businesses", "90 days", "180 days"],
      rows: [
        ...SPONSOR_PROGRAMME_PRICES.map((row) => ({
          label: `Up to ${row.capacity}`,
          cells: [formatPlanPrice(row.price90Cents), formatPlanPrice(row.price180Cents)],
        })),
        { label: `More than ${sponsorMax.capacity}`, cells: ["Custom proposal"] },
      ],
    },
  };

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
                <span className="gold-shine text-brand-gold-300">
                  know who they are dealing with.
                </span>
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

        {/* 1b ── Video-first ────────────────────────────────── */}
        <section
          id="video"
          aria-labelledby="advertise-video-title"
          className="container-page scroll-mt-24 py-12 sm:py-16"
        >
          <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] lg:gap-16">
            <Reveal>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-green-700 dark:text-brand-green-300">
                Video-first
              </p>
              <h2 id="advertise-video-title" className="section-title mt-2">
                A short video sells what a photo can&rsquo;t
              </h2>
              <p className="section-lede">
                Every post can carry photos and a short video. Buyers see the real thing, hear you,
                and know what to expect before they pick up the phone.
              </p>
              <ul className="mt-6 grid gap-3">
                {VIDEO_POINTS.map(({ icon: Icon, title, body }) => (
                  <SpotlightCard
                    as="li"
                    key={title}
                    className="flex gap-4 rounded-2xl border border-border/70 bg-card p-4 elev-xs"
                  >
                    <span className="icon-tile h-11 w-11 rounded-2xl bg-brand-gold/20 text-brand-gold-800 dark:bg-brand-gold/15 dark:text-brand-gold-300">
                      <Icon aria-hidden="true" className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-body text-base font-bold text-foreground">{title}</h3>
                      <p className="mt-0.5 text-sm leading-6 text-muted-foreground">{body}</p>
                    </div>
                  </SpotlightCard>
                ))}
              </ul>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Button asChild variant="ink" className="h-11 rounded-full">
                  <Link href="/post/create">Post with a video</Link>
                </Button>
                <p className="self-center text-sm text-muted-foreground">
                  Videos are reviewed with the rest of your post before it goes live.
                </p>
              </div>
            </Reveal>
            <Reveal delay={150}>
              <VideoShowcase />
            </Reveal>
          </div>
        </section>

        {/* 2 ── Why post here ───────────────────────────────── */}
        <section aria-labelledby="advertise-why-title" className="container-page py-12 sm:py-16">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-green-700 dark:text-brand-green-300">
              Why post here
            </p>
            <h2 id="advertise-why-title" className="section-title mt-2">
              People buy from people they trust
            </h2>
            <p className="section-lede">
              Most online classifieds leave buyers guessing who is behind a post. Here, the person
              behind every post has been reviewed, and that gives buyers a reason to choose you.
            </p>
          </div>
          <Reveal>
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {BENEFITS.map(({ icon: Icon, title, body }) => (
                <SpotlightCard
                  as="li"
                  key={title}
                  className="rounded-2xl border border-border/70 bg-card p-5 elev-xs"
                >
                  <span className="icon-tile h-11 w-11 rounded-2xl bg-brand-gold/20 text-brand-gold-800 dark:bg-brand-gold/15 dark:text-brand-gold-300">
                    <Icon aria-hidden="true" className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 font-body text-base font-bold text-foreground">{title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{body}</p>
                </SpotlightCard>
              ))}
            </ul>
          </Reveal>
        </section>

        {/* 3 ── Which one is for you ────────────────────────── */}
        <section
          id="packages"
          aria-labelledby="advertise-ways-title"
          className="scroll-mt-24 border-y border-border/60 bg-card/50"
        >
          <div className="container-page py-12 sm:py-16">
            <h2 id="advertise-ways-title" className="section-title">
              Which one is for you?
            </h2>
            <p className="section-lede">
              Three ways to advertise. Pick the one that matches what you do, then read the full
              details below.
            </p>
            <Reveal>
              <ul className="mt-8 grid gap-4 lg:grid-cols-3">
                {PACKAGES.map(({ id, icon: Icon, name, who }) => (
                  <SpotlightCard
                    as="li"
                    key={id}
                    className="flex flex-col rounded-3xl border border-border/70 bg-background p-5 elev-xs sm:p-6"
                  >
                    <span className="icon-tile h-11 w-11 rounded-2xl area-business-tile">
                      <Icon aria-hidden="true" className="h-5 w-5" />
                    </span>
                    <h3 className="mt-4 font-display text-xl font-bold text-foreground">{name}</h3>
                    <p className="mt-1 flex-1 text-sm leading-6 text-muted-foreground">{who}</p>
                    <Button asChild variant="outline" className="mt-5 h-11 w-full rounded-full">
                      <Link href={`#${id}`}>
                        Full details of {name}
                        <ArrowRight aria-hidden="true" className="ml-1.5 h-4 w-4" />
                      </Link>
                    </Button>
                  </SpotlightCard>
                ))}
              </ul>
            </Reveal>
          </div>
        </section>

        {/* 4 ── The three packages in full ──────────────────── */}
        {PACKAGES.map((pkg, index) => (
          <PackageSection key={pkg.id} pkg={pkg} sheet={sheets[pkg.id]} shaded={index % 2 === 1}>
            {pkg.id === "programmes" ? (
              <div className="rounded-2xl border border-brand-gold/40 bg-brand-gold/10 p-4 text-sm">
                <p className="font-semibold text-foreground">Founding pilots</p>
                <p className="mt-1 text-muted-foreground">
                  3 programmes in the City of uMhlathuze, up to 25 businesses each, free for 90
                  days. Invitations close on 31 December 2026. Nothing renews or charges
                  automatically.
                </p>
              </div>
            ) : null}
          </PackageSection>
        ))}

        {/* 5 ── Where your post appears ─────────────────────── */}
        <section
          aria-labelledby="advertise-areas-title"
          className="border-y border-border/60 bg-card/50"
        >
          <div className="container-page py-12 sm:py-16">
            <h2 id="advertise-areas-title" className="section-title">
              Where your post appears
            </h2>
            <Reveal>
              <ul className="mt-7 grid gap-4 md:grid-cols-3">
                {AREAS.map(({ icon: Icon, tile, name, body, href, browse }) => (
                  <SpotlightCard
                    as="li"
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
                  </SpotlightCard>
                ))}
              </ul>
            </Reveal>
          </div>
        </section>

        {/* 6 ── What we check, and what we don't ─────────────── */}
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

        {/* 7 ── Get more eyes on a post ─────────────────────── */}
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
            <Reveal>
              <ul className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {EXTRAS.map(({ icon: Icon, name, price, body }) => (
                  <SpotlightCard
                    as="li"
                    key={name}
                    className="surface-card flex gap-4 p-4 sm:flex-col sm:gap-0 sm:p-5"
                  >
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
                  </SpotlightCard>
                ))}
              </ul>
            </Reveal>
          </div>
        </section>

        {/* 8 ── Sample report ───────────────────────────────── */}
        <section aria-labelledby="advertise-report-title">
          <div className="container-page py-12 sm:py-16">
            <h2 id="advertise-report-title" className="section-title">
              What a partner report looks like
            </h2>
            <figure className="mt-7 max-w-3xl rounded-2xl border border-border/70 bg-card p-5">
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

        {/* 9 ── How it works ────────────────────────────────── */}
        <section aria-labelledby="advertise-steps-title" className="container-page py-12 sm:py-16">
          <h2 id="advertise-steps-title" className="section-title">
            How it works
          </h2>
          <ol className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <SpotlightCard
                as="li"
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
              </SpotlightCard>
            ))}
          </ol>
        </section>

        {/* 10 ── FAQ ─────────────────────────────────────────── */}
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

        {/* 11 ── Final call to action ───────────────────────── */}
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
