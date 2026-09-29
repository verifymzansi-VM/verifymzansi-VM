import Link from "next/link";
import { Check, CreditCard, Eye, MapPin, MessageSquare, TriangleAlert, UserX } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { InfoHero, SectionHeading } from "@/components/safety/info-hero";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Scam alerts",
  description:
    "Learn how to spot and avoid scams on online marketplaces. Stay safe when buying and selling in South Africa.",
};

const SCAM_TYPES = [
  {
    icon: CreditCard,
    title: "Deposit scams",
    description: "Pay a deposit or courier fee before you see the item.",
    redFlags: ["Upfront EFT or e-wallet payment", "Fake proof-of-payment screenshots"],
    whatToDo: ["Pay only after you inspect it", "Check your own banking app for cleared funds"],
  },
  {
    icon: UserX,
    title: "Fake profiles",
    description: "Stolen photos and names to look trustworthy.",
    redFlags: ["No trust badge, or Incomplete", "Name in chat doesn't match the profile"],
    whatToDo: ["Check the trust badge first", "Ask for a fresh photo of the item"],
  },
  {
    icon: MapPin,
    title: "Won’t meet",
    description: "Endless excuses, or a private address.",
    redFlags: ["“Out of town, I’ll courier it”", "Meeting place changes last minute"],
    whatToDo: ["Meet only in a busy public place", "Walk away if it moves somewhere private"],
    link: { href: "/safety/meeting-checklist", label: "Meeting checklist" },
  },
  {
    icon: Eye,
    title: "Too good to be true",
    description: "Prices far below similar listings.",
    redFlags: ["Brand-new account, many pricey items", "“Emigrating, need cash fast”"],
    whatToDo: ["Compare similar listings", "Ask for proof of ownership"],
  },
  {
    icon: MessageSquare,
    title: "Off-platform chats",
    description: "Pushing you to WhatsApp or Telegram straight away.",
    redFlags: ["Links to “payment portals”", "Asks for an OTP or PIN"],
    whatToDo: ["Keep chats on VerifyMzansi", "Never share an OTP or PIN"],
  },
] as const;

const GOLDEN_RULES = [
  "Deal with ID Reviewed accounts",
  "Never pay before inspecting",
  "Meet in public, in daylight",
  "Tell someone where you are going",
  "Walk away if unsure",
] as const;

const IF_SCAMMED = [
  "Stop contact and payments",
  "Call your bank's fraud line",
  "Open a case at SAPS",
  "Report the account to us",
] as const;

export default function ScamAlertsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main id="main-content" className="flex-1">
        <InfoHero
          title="Scam alerts"
          tone="gold"
          description="Spot the most common scams in South Africa, and what to do instead."
          breadcrumbs={[{ label: "Safety", href: "/safety" }, { label: "Scam alerts" }]}
        />

        <div className="container-page space-y-14 py-10 sm:space-y-16 sm:py-14">
          {/* ── Scam types ────────────────────────────────────────── */}
          <section aria-labelledby="scams-title">
            <SectionHeading id="scams-title" title="Common scams" />
            <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {SCAM_TYPES.map((scam) => {
                const Icon = scam.icon;
                return (
                  <li
                    key={scam.title}
                    className="flex flex-col overflow-hidden rounded-3xl border border-border/70 bg-card elev-xs"
                  >
                    <div className="flex items-start gap-3 p-5 pb-4">
                      <span className="icon-tile bg-brand-gold/15 text-brand-gold-800 dark:text-brand-gold-300">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-body text-base font-semibold leading-6 text-foreground">
                          {scam.title}
                        </h3>
                        <p className="text-sm text-muted-foreground">{scam.description}</p>
                      </div>
                    </div>

                    <div className="grid flex-1 gap-3 px-5 pb-5">
                      <div className="rounded-2xl bg-brand-red-50 p-4 dark:bg-brand-red-950/30">
                        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-brand-red-700 dark:text-brand-red-300">
                          <TriangleAlert className="h-4 w-4" aria-hidden="true" />
                          Red flags
                        </h4>
                        <ul className="mt-1.5 space-y-1">
                          {scam.redFlags.map((flag) => (
                            <li key={flag} className="text-sm leading-6 text-foreground/85">
                              {flag}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="rounded-2xl bg-brand-green/5 p-4 dark:bg-brand-green/10">
                        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-brand-green-800 dark:text-brand-green-300">
                          <Check className="h-4 w-4" aria-hidden="true" />
                          What to do
                        </h4>
                        <ul className="mt-1.5 space-y-1">
                          {scam.whatToDo.map((tip) => (
                            <li key={tip} className="text-sm leading-6 text-foreground/85">
                              {tip}
                            </li>
                          ))}
                        </ul>
                        {"link" in scam && (
                          <Link
                            href={scam.link.href}
                            className="mt-1 inline-flex min-h-10 items-center text-sm font-semibold text-brand-green-700 underline underline-offset-4 hover:text-brand-green-800 dark:text-brand-green-300"
                          >
                            {scam.link.label}
                          </Link>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* ── If you've been scammed ────────────────────────────── */}
          <section
            aria-labelledby="scammed-title"
            className="rounded-3xl border border-brand-red/25 bg-brand-red-50 p-5 dark:border-brand-red/30 dark:bg-brand-red-950/30 sm:p-7"
          >
            <div className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center lg:gap-10">
              <div>
                <h2
                  id="scammed-title"
                  className="font-display text-xl font-bold text-foreground sm:text-2xl"
                >
                  If you&apos;ve been scammed
                </h2>
                <p className="mt-1 text-sm text-foreground/80">Act fast and keep all evidence.</p>
                <div className="mt-4 flex flex-wrap gap-2.5">
                  <Button asChild variant="destructive">
                    <Link href="/contact?topic=fraud_report">Report a scam</Link>
                  </Button>
                  <Button asChild variant="outline">
                    <a href="tel:10111">Call SAPS 10111</a>
                  </Button>
                </div>
              </div>
              <ol className="grid gap-2.5 sm:grid-cols-2">
                {IF_SCAMMED.map((step, index) => (
                  <li
                    key={step}
                    className="flex items-center gap-3 rounded-2xl bg-card/80 p-3.5 text-sm font-medium text-foreground"
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-red-600 text-xs font-bold text-white"
                    >
                      {index + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {/* ── Golden rules ──────────────────────────────────────── */}
          <section aria-labelledby="rules-title">
            <SectionHeading id="rules-title" title="Golden rules" />
            <ul className="mt-5 flex flex-wrap gap-2.5">
              {GOLDEN_RULES.map((rule) => (
                <li
                  key={rule}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border/70 bg-card px-4 text-sm font-medium text-foreground"
                >
                  <Check
                    className="h-4 w-4 shrink-0 text-brand-green-700 dark:text-brand-green-300"
                    aria-hidden="true"
                  />
                  {rule}
                </li>
              ))}
            </ul>
            <p className="mt-5 text-sm text-muted-foreground">
              Seen something suspicious?{" "}
              <Link
                href="/contact?topic=fraud_report"
                className="font-semibold text-brand-green-700 underline underline-offset-4 dark:text-brand-green-300"
              >
                Report it
              </Link>
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
