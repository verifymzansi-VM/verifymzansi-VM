import Image from "next/image";
import Link from "next/link";
import { Check, Fingerprint, MapPin, Smartphone } from "lucide-react";
import { HeaderSearch } from "@/components/layout/header-search";
import { VerifiedTick } from "@/components/trust/verified-tick";
import { BrandShield } from "@/components/shared/brand-shield";

const QUICK_LINKS = [
  { label: "Cars & bakkies", href: "/mzansi-market?category=vehicles" },
  { label: "Phones & tech", href: "/mzansi-market?category=electronics" },
  { label: "Property", href: "/mzansi-market?category=property" },
  { label: "Trades & repairs", href: "/mzansi-business?category=trade_maintenance" },
  { label: "Food & dining", href: "/mzansi-business?category=food_dining" },
  { label: "Stays & events", href: "/tourism-events" },
] as const;

const CHECKLIST = [
  { icon: Smartphone, label: "Phone number" },
  { icon: Fingerprint, label: "ID document & selfie" },
  { icon: MapPin, label: "Location" },
] as const;

/**
 * Homepage hero: answers "what is this, what can I find, why trust it, how do
 * I start" in the first screen, with search as the primary action.
 */
export function HomeHero() {
  return (
    <section
      aria-labelledby="home-hero-title"
      className="bg-hero-mesh relative overflow-hidden border-b border-border/60"
    >
      <div
        aria-hidden="true"
        className="mzansi-pattern pointer-events-none absolute inset-0 opacity-[0.035] dark:opacity-[0.05] dark:invert [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
      />
      <div className="container-page relative grid items-center gap-10 pb-10 pt-8 sm:pt-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-14 lg:pb-16 lg:pt-16">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 rounded-full border border-brand-green/20 bg-card/80 py-1 pl-1.5 pr-3.5 text-xs font-semibold text-foreground/80 shadow-xs backdrop-blur sm:text-sm">
            <VerifiedTick decorative className="h-5 w-5" />
            South Africa&apos;s trust-first marketplace
          </p>

          <h1
            id="home-hero-title"
            className="mt-5 font-display text-[2.35rem] font-extrabold leading-[1.02] tracking-[-0.035em] text-foreground sm:text-5xl lg:text-[3.6rem]"
          >
            Buy, sell and discover with people you can trust.
          </h1>

          <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
            Everyone who posts here is ID-reviewed first.
          </p>

          <HeaderSearch
            size="lg"
            className="mt-7 max-w-xl"
            placeholder="What are you looking for today?"
          />

          <nav aria-label="Popular searches" className="mt-4 max-w-2xl">
            <ul className="flex flex-wrap gap-2">
              {QUICK_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} prefetch={false} className="pill-link">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        {/* Visual: real South African settings with the trust layer on top */}
        <div className="relative mx-auto hidden w-full max-w-[560px] lg:block" aria-hidden="true">
          <div className="grid grid-cols-[1.15fr_0.85fr] grid-rows-[220px_220px] gap-4">
            <div className="relative row-span-2 overflow-hidden rounded-[28px] shadow-xl ring-1 ring-black/5">
              <Image
                src="/images/showrooms/tourism-v2-mobile.avif"
                alt=""
                fill
                sizes="320px"
                priority
                className="object-cover"
              />
              <span className="absolute left-3 top-3 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-sunset-700 shadow-sm backdrop-blur">
                Tourism &amp; Events
              </span>
            </div>
            <div className="relative overflow-hidden rounded-[28px] shadow-lg ring-1 ring-black/5">
              <Image
                src="/images/showrooms/market-v2-mobile.avif"
                alt=""
                fill
                sizes="240px"
                className="object-cover"
              />
              <span className="absolute left-3 top-3 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-brand-green-700 shadow-sm backdrop-blur">
                Mzansi Market
              </span>
            </div>
            <div className="relative overflow-hidden rounded-[28px] shadow-lg ring-1 ring-black/5">
              <Image
                src="/images/showrooms/business-v2-mobile.avif"
                alt=""
                fill
                sizes="240px"
                className="object-cover"
              />
              <span className="absolute left-3 top-3 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-brand-blue-700 shadow-sm backdrop-blur">
                Mzansi Business
              </span>
            </div>
          </div>

          {/* Floating verification card */}
          <div className="absolute -bottom-6 -left-10 w-64 animate-float rounded-3xl border border-border/70 bg-card/95 p-4 shadow-2xl backdrop-blur-md motion-reduce:animate-none">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-green-600 text-white">
                <BrandShield className="h-6 w-6" />
              </span>
              <div>
                <p className="text-sm font-bold text-foreground">Seller checks</p>
              </div>
            </div>
            <ul className="mt-3 space-y-2">
              {CHECKLIST.map(({ icon: Icon, label }) => (
                <li
                  key={label}
                  className="flex items-center justify-between rounded-xl bg-muted/70 px-3 py-2 text-xs font-medium text-foreground/85"
                >
                  <span className="inline-flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    {label}
                  </span>
                  <Check className="h-4 w-4 text-brand-green-600" strokeWidth={3} />
                </li>
              ))}
            </ul>
          </div>

          <div className="absolute -bottom-5 right-6 flex items-center gap-2 rounded-full border border-border/70 bg-card/95 px-3.5 py-2 text-xs font-semibold shadow-xl backdrop-blur">
            <span className="h-2 w-2 rounded-full bg-brand-gold" />
            Every post is moderated
          </div>
        </div>
      </div>
    </section>
  );
}
