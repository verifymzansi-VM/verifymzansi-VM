import Link from "next/link";
import { ArrowRight, Fingerprint, Flag, MapPin, Smartphone, Users } from "lucide-react";
import { BrandShield } from "@/components/shared/brand-shield";
import { TrustBadge } from "@/components/trust/trust-badge";

const STEPS = [
  {
    icon: Smartphone,
    title: "Phone confirmed",
    body: "A real SA number.",
  },
  {
    icon: Fingerprint,
    title: "ID & selfie reviewed",
    body: "Checked by our team.",
  },
  {
    icon: MapPin,
    title: "Location checked",
    body: "Where they operate.",
  },
  {
    icon: BrandShield,
    title: "Badge earned",
    body: "Shown on every post.",
  },
] as const;

/** Short, plain notes beside each public badge (the badge itself carries the legal label). */
const BADGE_NOTES = [
  { level: 2, note: "Checks submitted, in review" },
  { level: 3, note: "Identity evidence reviewed" },
  { level: 4, note: "Identity reviewed, Pro account" },
] as const;

const SAFETY_LINKS = [
  { href: "/safety/meeting-checklist", icon: Users, label: "Meet safely" },
  { href: "/safety/scam-alerts", icon: Flag, label: "Spot scams" },
  { href: "/verify-buyer", icon: BrandShield, label: "Verify a buyer" },
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
            <h2
              id="home-trust-title"
              className="font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl"
            >
              Know who you&apos;re dealing with.
            </h2>

            <ol className="mt-7 grid gap-3 sm:grid-cols-2">
              {STEPS.map(({ icon: Icon, title, body }) => (
                <li
                  key={title}
                  className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-green-500/15 text-brand-green-300">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-body text-base font-semibold text-white">{title}</h3>
                    <p className="text-sm text-white/70">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-3xl bg-white p-5 text-foreground shadow-2xl dark:bg-card sm:p-6">
              <h3 className="font-body text-base font-bold">What the badges mean</h3>
              <ul className="mt-4 space-y-3">
                {BADGE_NOTES.map(({ level, note }) => (
                  <li key={level} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <TrustBadge level={level} size="md" className="shrink-0" />
                    <p className="text-sm text-muted-foreground">{note}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-muted-foreground">
                Badges show checks were done. They are not a guarantee.
              </p>
              <Link href="/trust-safety" prefetch={false} className="link-arrow mt-4 font-semibold">
                How verification works
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>

            <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              {SAFETY_LINKS.map(({ href, icon: Icon, label }) => (
                <li key={href}>
                  <Link
                    href={href}
                    prefetch={false}
                    className="group flex h-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-brand-gold-300">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-semibold text-white">{label}</span>
                    <ArrowRight
                      className="h-4 w-4 shrink-0 text-white/50 transition-transform group-hover:translate-x-0.5 group-hover:text-white motion-reduce:transition-none"
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
