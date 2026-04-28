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
            <span
              className="inline-block w-4 h-3 rounded-sm overflow-hidden"
              role="img"
              aria-label="South African flag"
            >
              {/* SA flag mini icon — CSS gradient */}
              <span className="block w-full h-full sa-flag-mini" aria-hidden="true" />
            </span>
            <span>Made in South Africa</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
