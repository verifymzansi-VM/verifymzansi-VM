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

export function Footer() {
  const currentYear = new Date().getFullYear();
  const runtimeConfig = getServerPublicRuntimeConfig();
  const footerLinkClassName =
    "inline-flex min-h-6 items-center rounded-md py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

  return (
    <footer className="border-t bg-warm-50 dark:bg-warm-950">
      <div className="container-page py-4 pb-[calc(env(safe-area-inset-bottom)+8rem)] md:pb-4">
        {/* Mobile nav is h-16 (64px). Extra bottom spacing keeps legal links above nav across mobile browsers. */}
        <h2 className="sr-only">Footer navigation</h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4 lg:grid-cols-5">
          {/* Brand */}
          <div className="space-y-2">
            <Link href="/" prefetch={false} className="flex items-center gap-1.5">
              <BrandLogo size="sm" />
            </Link>
            <p className="text-xs text-muted-foreground max-w-xs">
              Mzansi&apos;s Proudly Trusted Market.
            </p>
          </div>

          {footerSections.map((section) => (
            <div key={section.title} className="space-y-2">
              <h3 className="font-display font-semibold text-xs">{section.title}</h3>
              <nav aria-label={section.title} className="flex flex-col gap-1.5">
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
            linkClassName="inline-flex items-center rounded-full border border-border/70 px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          />
        </div>

        <Separator className="my-3 sm:my-4" />

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <p>&copy; {currentYear} VerifyMzansi. All rights reserved.</p>
          <div className="flex items-center gap-1">
            <svg
              className="h-3 w-5 rounded-[2px] shadow-[0_0_0_1px_rgba(0,0,0,0.16)]"
              viewBox="0 0 90 60"
              role="img"
              aria-label="South African flag"
            >
              <clipPath id="south-african-flag-clip">
                <rect width="90" height="60" rx="4" />
              </clipPath>
              <g clipPath="url(#south-african-flag-clip)">
                <path fill="#de3831" d="M0 0h90v30H45z" />
                <path fill="#002395" d="M45 30h45v30H0z" />
                <path
                  fill="#fff"
                  d="M0 0v60l39-30L0 0Zm90 20H39l-13-10h64v10Zm0 20H39L26 50h64V40Z"
                />
                <path fill="#ffb81c" d="M0 6v48l31-24L0 6Z" />
                <path fill="#000" d="M0 12v36l23-18L0 12Z" />
                <path
                  fill="#007a4d"
                  d="M0 0v9l27 21L0 51v9l39-30L0 0Zm90 24H37l-8-6h61v6Zm0 12H37l-8 6h61v-6Z"
                />
              </g>
            </svg>
            <span>Made in South Africa</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
