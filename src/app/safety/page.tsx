import Link from "next/link";
import {
  ArrowRight,
  Flag,
  FolderLock,
  Gavel,
  MessageSquareWarning,
  Phone,
  Users,
  Wallet,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { BrandShield, BrandShieldAlert } from "@/components/shared/brand-shield";
import { brandOutlineButtonClassName } from "@/components/brand";
import { InfoHero, SectionHeading } from "@/components/safety/info-hero";
import { Button } from "@/components/ui/button";
import { SAFETY_RULES as safetyRules } from "@/lib/constants/safety-rules";

export const metadata = {
  title: "Safety Centre",
  description:
    "Buyer and seller safety guidance for VerifyMzansi users in South Africa, including scam warnings, safe meetings, disputes, reports, and appeals.",
};

/** Icons for each canonical safety rule, in SAFETY_RULES order. */
const TIP_ICONS = [Wallet, Users, MessageSquareWarning, FolderLock, Flag] as const;

const GUIDES = [
  {
    href: "/safety/scam-alerts",
    icon: BrandShieldAlert,
    title: "Scam alerts",
    body: "Red flags to watch for",
    tile: "bg-brand-red/10 text-brand-red-700 dark:bg-brand-red/15 dark:text-brand-red-300",
  },
  {
    href: "/safety/meeting-checklist",
    icon: Users,
    title: "Meeting checklist",
    body: "Before, during and after",
    tile: "bg-brand-gold/15 text-brand-gold-800 dark:text-brand-gold-300",
  },
  {
    href: "/verify-buyer",
    icon: BrandShield,
    title: "Verify a buyer",
    body: "Check a buyer token",
    tile: "area-market-tile",
  },
  {
    href: "/trust-safety",
    icon: BrandShield,
    title: "How verification works",
    body: "What badges mean",
    tile: "area-business-tile",
  },
] as const;

const responseSteps = [
  { title: "Report suspicious listings", description: "Use Report on the post, or contact us." },
  { title: "Moderation review", description: "We can remove posts and restrict accounts." },
  { title: "Appeals", description: "Think we got it wrong? Send fresh evidence." },
] as const;

export default function SafetyCentrePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main id="main-content" className="flex-1">
        <InfoHero
          title="Safety Centre"
          description="Buy, sell and meet safely, and get help when something goes wrong."
          breadcrumbs={[{ label: "Safety Centre" }]}
          actions={
            <>
              <Button asChild variant="trust-verified" size="lg">
                <Link href="/contact?topic=fraud_report">Report a problem</Link>
              </Button>
              <Button asChild variant="outline" size="lg" className={brandOutlineButtonClassName}>
                <a href="#emergency">Emergency numbers</a>
              </Button>
            </>
          }
        />

        <div className="container-page space-y-14 py-10 sm:space-y-16 sm:py-14">
          {/* ── Guides ───────────────────────────────────────────── */}
          <section aria-labelledby="guides-title">
            <h2 id="guides-title" className="sr-only">
              Safety guides
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {GUIDES.map(({ href, icon: Icon, title, body, tile }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="group surface-card flex h-full items-center gap-4 p-4 transition-shadow duration-200 hover:elev-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:p-5"
                  >
                    <span className={`icon-tile h-11 w-11 ${tile}`}>
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-body text-base font-semibold text-foreground">
                        {title}
                      </span>
                      <span className="block text-sm text-muted-foreground">{body}</span>
                    </span>
                    <ArrowRight
                      className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-foreground"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {/* ── Tips ─────────────────────────────────────────────── */}
          <section aria-labelledby="tips-title">
            <SectionHeading id="tips-title" title="Buyer and seller rules" />
            <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {safetyRules.map((rule, index) => {
                const Icon = TIP_ICONS[index] ?? Flag;
                return (
                  <li key={rule} className="surface-card flex gap-3 p-4 lg:flex-col lg:p-5">
                    <span className="icon-tile area-market-tile">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <p className="text-sm font-medium leading-6 text-foreground">{rule}</p>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* ── Report path ──────────────────────────────────────── */}
          <section
            aria-labelledby="report-title"
            className="hero-panel grid gap-8 p-5 sm:p-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-12"
          >
            <div>
              <span className="icon-tile bg-brand-red/10 text-brand-red-700 dark:bg-brand-red/15 dark:text-brand-red-300">
                <Flag className="h-5 w-5" aria-hidden="true" />
              </span>
              <h2 id="report-title" className="mt-4 section-title">
                Reports, disputes, and appeals
              </h2>
              <p className="section-lede">Something not right? Tell us.</p>
              <div className="mt-5 flex flex-wrap gap-2.5">
                <Button asChild variant="trust-verified">
                  <Link href="/contact?topic=fraud_report">Report a problem</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/contact?topic=verification_appeal">Appeal a decision</Link>
                </Button>
              </div>
            </div>

            <ol className="space-y-3">
              {responseSteps.map((step, index) => (
                <li
                  key={step.title}
                  className="flex items-center gap-4 rounded-2xl border border-border/60 bg-background/60 p-4"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-green-600 text-sm font-bold text-white dark:bg-brand-green-500 dark:text-brand-green-950"
                  >
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="font-body text-sm font-semibold text-foreground">
                      {step.title}
                    </h3>
                    <p className="text-sm text-muted-foreground">{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* ── Emergency ────────────────────────────────────────── */}
          <section
            id="emergency"
            aria-labelledby="emergency-title"
            className="scroll-mt-32 rounded-3xl border border-brand-red/25 bg-brand-red-50 p-5 dark:border-brand-red/30 dark:bg-brand-red-950/30 sm:p-8"
          >
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="flex items-start gap-4">
                <span className="icon-tile bg-brand-red/15 text-brand-red-700 dark:text-brand-red-300">
                  <Gavel className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h2
                    id="emergency-title"
                    className="font-display text-xl font-bold text-foreground sm:text-2xl"
                  >
                    Crime? Report it to SAPS.
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-foreground/80">
                    We can remove content, but can&apos;t recover money or goods.
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2.5 sm:flex-row">
                <a
                  href="tel:10111"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-red-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Phone className="h-4 w-4" aria-hidden="true" />
                  Call SAPS 10111
                </a>
                <a
                  href="tel:112"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-brand-red/30 bg-card px-5 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Phone className="h-4 w-4" aria-hidden="true" />
                  Call 112
                </a>
              </div>
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
