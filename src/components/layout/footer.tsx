import Link from "next/link";
import { BrandLogo } from "../shared/brand-logo";
import { Separator } from "@/components/ui/separator";
import { getServerPublicRuntimeConfig } from "@/lib/public-runtime-config";
import { OfficialSocialLinks } from "@/components/shared/official-social-links";

const footerSections = [
  {
    title: "Marketplace",
    links: [
      { href: "/mzansi-market", label: "Mzansi Market" },
      { href: "/mzansi-business", label: "Mzansi Business" },
      { href: "/tourism-events", label: "Tourism & Events" },
      { href: "/advertise", label: "Advertise" },
    ],
  },
  {
    title: "Safety",
    links: [
      { href: "/trust-safety", label: "Trust & Safety" },
      { href: "/safety", label: "Safety Centre" },
      { href: "/safety/scam-alerts", label: "Scam Alerts" },
      { href: "/safety/meeting-checklist", label: "Meeting Safety" },
      { href: "/verify-buyer", label: "Verify a Buyer" },
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
      className="h-4 w-6 shrink-0 rounded-[3px] shadow-[0_0_0_1px_rgba(15,23,42,0.18),0_1px_2px_rgba(15,23,42,0.16)]"
      viewBox="0 0 300 200"
      role="img"
      aria-label="South African flag"
      focusable="false"
    >
      <defs>
        <clipPath id="south-african-flag-clip">
          <rect width="300" height="200" rx="10" />
        </clipPath>
      </defs>
      <g clipPath="url(#south-african-flag-clip)">
        <path fill="#e03c31" d="M0 0h300v100H0z" />
        <path fill="#001489" d="M0 100h300v100H0z" />
        <path fill="#fff" d="M0 0h50l110 73.333H300v53.334H160L50 200H0l150-100L0 0Z" />
        <path fill="#007a4d" d="M0 20h38l108 72h154v16H146L38 180H0l120-80L0 20Z" />
        <path fill="#ffb81c" d="M0 0l150 100L0 200V0Z" />
        <path fill="#000" d="M0 20l120 80L0 180V20Z" />
      </g>
    </svg>
  );
}

export function Footer() {
  const currentYear = new Date().getFullYear();
  const runtimeConfig = getServerPublicRuntimeConfig();
  const footerLinkClassName =
    "inline-flex min-h-7 items-center rounded-md py-1 text-[13px] text-muted-foreground transition-colors duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

  return (
    <footer className="border-t border-border/50 bg-warm-50/70 dark:bg-warm-950/60">
      <div className="container-page py-10 pb-[calc(env(safe-area-inset-bottom)+8rem)] md:py-14 md:pb-14">
        {/* Mobile nav is h-16 (64px). Extra bottom spacing keeps legal links above nav across mobile browsers. */}
        <h2 className="sr-only">Footer navigation</h2>
        <div className="grid grid-cols-2 gap-8 sm:gap-10 sm:grid-cols-4 lg:grid-cols-5">
          {/* Brand */}
          <div className="space-y-3">
            <Link href="/" prefetch={false} className="flex items-center gap-1.5">
              <BrandLogo size="sm" />
            </Link>
            <p className="text-[13px] leading-6 text-muted-foreground max-w-xs">
              Find and post trusted local listings, services, tourism, and events in South Africa.
            </p>
          </div>

          {footerSections.map((section) => (
            <div key={section.title} className="space-y-3">
              <h3 className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/80">
                {section.title}
              </h3>
              <nav aria-label={section.title} className="flex flex-col gap-1">
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
            linkClassName="inline-flex items-center rounded-full border border-border/60 bg-background/60 px-3 py-1 text-xs text-muted-foreground transition-colors duration-200 hover:border-border hover:text-foreground"
          />
        </div>

        <Separator className="my-6 sm:my-8 opacity-60" />

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <p>&copy; {currentYear} VerifyMzansi. All rights reserved.</p>
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/80 px-3.5 py-1.5 elev-xs">
            <SouthAfricanFlagMark />
            <span className="font-medium">Made in South Africa</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
