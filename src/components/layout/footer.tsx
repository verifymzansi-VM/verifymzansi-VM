import Link from "next/link";
import { BrandLogo } from "../shared/brand-logo";
import { Separator } from "@/components/ui/separator";
import { getServerPublicRuntimeConfig } from "@/lib/public-runtime-config";
import { OfficialSocialLinks } from "@/components/shared/official-social-links";

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

          {/* Marketplace */}
          <div className="space-y-2">
            <h3 className="font-display font-semibold text-xs">Marketplace</h3>
            <nav aria-label="Marketplace" className="flex flex-col gap-1.5">
              <Link href="/mzansi-market" prefetch={false} className={footerLinkClassName}>
                Mzansi Market
              </Link>
              <Link href="/mzansi-business" prefetch={false} className={footerLinkClassName}>
                Mzansi Business
              </Link>
              <Link href="/promotions" prefetch={false} className={footerLinkClassName}>
                Tourism & Events
              </Link>
              <Link href="/advertise" prefetch={false} className={footerLinkClassName}>
                Advertise
              </Link>
            </nav>
          </div>

          {/* Safety */}
          <div className="space-y-2">
            <h3 className="font-display font-semibold text-xs">Safety</h3>
            <nav aria-label="Safety" className="flex flex-col gap-1.5">
              <Link href="/safety/scam-alerts" prefetch={false} className={footerLinkClassName}>
                Scam Alerts
              </Link>
              <Link
                href="/safety/meeting-checklist"
                prefetch={false}
                className={footerLinkClassName}
              >
                Meeting Safety
              </Link>
              <Link href="/verify-buyer" prefetch={false} className={footerLinkClassName}>
                Verify a Buyer
              </Link>
            </nav>
          </div>

          {/* Legal */}
          <div className="space-y-2">
            <h3 className="font-display font-semibold text-xs">Legal</h3>
            <nav aria-label="Legal" className="flex flex-col gap-1.5">
              <Link href="/privacy" prefetch={false} className={footerLinkClassName}>
                Privacy Policy
              </Link>
              <Link href="/terms" prefetch={false} className={footerLinkClassName}>
                Terms of Service
              </Link>
            </nav>
          </div>

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
