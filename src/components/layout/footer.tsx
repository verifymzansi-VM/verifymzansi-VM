import Link from "next/link";
import { BrandLogo } from "../shared/brand-logo";
import { SaFlagStripe } from "@/components/brand/sa-flag-stripe";
import { BrandShield } from "@/components/shared/brand-shield";
import { getServerPublicRuntimeConfig } from "@/lib/public-runtime-config";
import { OfficialSocialLinks } from "@/components/shared/official-social-links";

const footerSections = [
  {
    title: "Marketplace",
    links: [
      { href: "/search", label: "Search website" },
      { href: "/mzansi-market", label: "Mzansi Market" },
      { href: "/mzansi-business", label: "Mzansi Business" },
      { href: "/tourism-events", label: "Tourism & Events" },
      { href: "/sponsors", label: "Programme partners" },
      { href: "/pricing", label: "Pricing" },
      { href: "/advertise", label: "Advertise" },
    ],
  },
  {
    title: "Safety",
    links: [
      { href: "/trust-safety", label: "Trust & Safety" },
      { href: "/safety", label: "Safety Centre" },
      { href: "/safety/scam-alerts", label: "Scam alerts" },
      { href: "/safety/meeting-checklist", label: "Meeting safety" },
      { href: "/verify-buyer", label: "Verify a buyer" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy", label: "Privacy Policy" },
      { href: "/terms", label: "Terms of Service" },
      { href: "/paia", label: "PAIA Manual" },
      { href: "/contact", label: "Contact" },
    ],
  },
] as const;

function SouthAfricanFlagMark() {
  return (
    <svg
      className="h-5 w-[30px] shrink-0 overflow-hidden rounded-[2px] ring-1 ring-white/25"
      viewBox="0 0 300 200"
      role="img"
      aria-label="South African flag"
      focusable="false"
    >
      <g>
        <path fill="#e03c31" d="M0 0h300v100H0z" />
        <path fill="#001489" d="M0 100h300v100H0z" />
        <path d="M0 0 150 100H300M150 100 0 200" fill="none" stroke="#fff" strokeWidth="66.667" />
        <path d="M0 0 150 100H300M150 100 0 200" fill="none" stroke="#007a4d" strokeWidth="40" />
        <path fill="#ffb81c" d="M0 24 114 100 0 176Z" />
        <path fill="#000" d="M0 40 90 100 0 160Z" />
      </g>
    </svg>
  );
}

export function Footer() {
  const currentYear = new Date().getFullYear();
  const runtimeConfig = getServerPublicRuntimeConfig();
  const footerLinkClassName =
    "inline-flex min-h-8 items-center rounded-md py-1 text-sm text-white/65 transition-colors duration-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green-300 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-green-950";

  return (
    <footer className="relative mt-auto overflow-hidden bg-brand-green-950 text-white">
      <SaFlagStripe className="relative" />
      <div
        aria-hidden="true"
        className="mzansi-pattern pointer-events-none absolute inset-0 opacity-[0.035] invert"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 right-[-10%] h-80 w-80 rounded-full bg-brand-green-500/20 blur-3xl"
      />

      {/* Call-to-action band */}
      <div className="relative border-b border-white/10">
        <div className="container-page flex flex-col gap-5 py-10 md:flex-row md:items-center md:justify-between md:py-12">
          <div className="max-w-xl">
            <p className="font-display text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
              Got something to sell, <span className="text-brand-gold-300">share or host?</span>
            </p>
            <p className="mt-2 text-sm text-white/70 sm:text-base">
              Get verified once, post anywhere.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/post/create"
              prefetch={false}
              className="inline-flex h-12 items-center gap-2 rounded-full bg-brand-green-500 px-6 text-sm font-semibold text-brand-green-950 transition-colors hover:bg-brand-green-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-green-950"
            >
              Post for free
            </Link>
            <Link
              href="/trust-safety"
              prefetch={false}
              className="inline-flex h-12 items-center gap-2 rounded-full border border-white/20 px-6 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-green-950"
            >
              <BrandShield className="h-4 w-4" />
              How verification works
            </Link>
          </div>
        </div>
      </div>

      <div className="container-page relative py-10 pb-[calc(env(safe-area-inset-bottom)+6.5rem)] md:py-14 md:pb-12">
        {/* Mobile nav is h-16 (64px). Extra bottom spacing keeps legal links above nav across mobile browsers. */}
        <h2 className="sr-only">Footer navigation</h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-9 sm:grid-cols-4 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
          {/* Brand */}
          <div className="col-span-2 space-y-4 sm:col-span-4 lg:col-span-1">
            <Link href="/" prefetch={false} className="inline-flex items-center">
              <BrandLogo size="sm" tone="inverse" />
            </Link>
            <p className="max-w-xs text-sm text-white/70">
              South Africa&apos;s trust-first marketplace.
            </p>
          </div>

          {footerSections.map((section) => (
            <div key={section.title} className="space-y-3">
              <h3 className="text-sm font-semibold text-white/85">{section.title}</h3>
              <nav aria-label={section.title} className="flex flex-col">
                {section.links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    prefetch={false}
                    className={footerLinkClassName}
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
            </div>
          ))}

          <OfficialSocialLinks
            links={runtimeConfig.officialSocialLinks}
            className="space-y-2"
            titleClassName="text-sm font-semibold text-white/85"
            linkClassName="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/75 transition-colors duration-200 hover:border-white/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          />
        </div>

        <div className="mt-10 flex flex-col-reverse items-start justify-between gap-4 border-t border-white/10 pt-6 text-xs text-white/50 sm:flex-row sm:items-center">
          <p>&copy; {currentYear} VerifyMzansi. All rights reserved.</p>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-white/80">
            <SouthAfricanFlagMark />
            <span className="font-medium">Made in South Africa</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
