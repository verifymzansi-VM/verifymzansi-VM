import Link from "next/link";
import { ArrowRight, Fingerprint, Flag, MapPin, Smartphone, Users } from "lucide-react";
import { BrandShield } from "@/components/shared/brand-shield";
import { TrustBadge } from "@/components/trust/trust-badge";
import { TRUST_TIERS } from "@/lib/constants/trust-scale";

const STEPS = [
  {
    icon: Smartphone,
    title: "Phone confirmed",
    body: "A one-time code links every account to a real South African number.",
  },
  {
    icon: Fingerprint,
    title: "ID & selfie reviewed",
    body: "ID evidence and a live selfie are checked by our team, then encrypted.",
  },
  {
    icon: MapPin,
    title: "Location checked",
    body: "A GPS or manual address check confirms where sellers operate.",
  },
  {
    icon: BrandShield,
    title: "Badge earned",
    body: "Only then does the ID Reviewed badge appear on profiles and posts.",
  },
] as const;

const SAFETY_LINKS = [
  {
    href: "/safety/meeting-checklist",
    icon: Users,
    label: "Meet safely",
    body: "Public places, daylight, bring a friend.",
  },
  {
    href: "/safety/scam-alerts",
    icon: Flag,
    label: "Spot scams",
    body: "Common tricks and how to avoid them.",
  },
  {
    href: "/verify-buyer",
    icon: BrandShield,
    label: "Verify a buyer",
    body: "Check someone before you hand over goods.",
  },
] as const;

export function HomeTrustSection() {
  return (
    <section aria-labelledby="home-trust-title" className="container-page py-12 sm:py-16">
      <div className="relative overflow-hidden rounded-[32px] bg-[#07130f] px-5 py-10 text-white sm:px-10 sm:py-14 lg:px-14">
        <div
          aria-hidden="true"
          className="mzansi-pattern pointer-events-none absolute inset-0 opacity-[0.05] invert"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-brand-green-500/25 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 right-0 h-72 w-72 rounded-full bg-brand-gold/15 blur-3xl"
        />

        <div className="relative grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-14">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-brand-green-200">
              <BrandShield className="h-3.5 w-3.5" />
              The trust layer
            </p>
            <h2
              id="home-trust-title"
              className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl"
            >
              Know who you&apos;re dealing with, before you meet.
            </h2>
            <p className="mt-3 max-w-xl text-base leading-7 text-white/70">
              Anyone can browse. Posting on VerifyMzansi starts with real checks, so the people
              behind listings, businesses and events are accountable.
            </p>

            <ol className="mt-8 grid gap-3 sm:grid-cols-2">
              {STEPS.map(({ icon: Icon, title, body }, index) => (
                <li
                  key={title}
                  className="relative rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-green-500/15 text-brand-green-300">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="text-xs font-semibold tabular-nums text-white/40">
                      Step {index + 1}
                    </span>
                  </div>
                  <h3 className="mt-3 font-body text-base font-semibold text-white">{title}</h3>
                  <p className="mt-1 text-sm leading-6 text-white/65">{body}</p>
                </li>
              ))}
            </ol>
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-3xl bg-white p-5 text-foreground shadow-2xl dark:bg-card sm:p-6">
              <h3 className="font-body text-base font-bold">What the badges mean</h3>
              <ul className="mt-4 space-y-3">
                {([2, 3, 4] as const).map((level) => (
                  <li key={level} className="flex items-start gap-3">
                    <TrustBadge level={level} size="md" className="mt-0.5 shrink-0" />
                    <p className="text-sm leading-6 text-muted-foreground">
                      {TRUST_TIERS[level].description}.
                    </p>
                  </li>
                ))}
              </ul>
              <p className="mt-4 rounded-2xl bg-muted/70 px-4 py-3 text-xs leading-5 text-muted-foreground">
                Badges show that checks were completed. They are not a guarantee, so always follow
                our safety tips when you trade.
              </p>
              <Link href="/trust-safety" prefetch={false} className="link-arrow mt-4 font-semibold">
                How verification works
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>

            <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              {SAFETY_LINKS.map(({ href, icon: Icon, label, body }) => (
                <li key={href}>
                  <Link
                    href={href}
                    prefetch={false}
                    className="group flex h-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-brand-gold-300">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-white">{label}</span>
                      <span className="block text-xs leading-5 text-white/60">{body}</span>
                    </span>
                    <ArrowRight
                      className="h-4 w-4 shrink-0 text-white/40 transition-transform group-hover:translate-x-0.5 group-hover:text-white"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
