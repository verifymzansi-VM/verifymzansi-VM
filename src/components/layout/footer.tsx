import Link from "next/link";
import { BrandLogo } from "../shared/brand-logo";
import { Separator } from "@/components/ui/separator";
import { getServerPublicRuntimeConfig } from "@/lib/public-runtime-config";
import { OfficialSocialLinks } from "@/components/shared/official-social-links";

export function Footer() {
  const currentYear = new Date().getFullYear();
  const runtimeConfig = getServerPublicRuntimeConfig();

  return (
    <footer className="border-t bg-warm-50 dark:bg-warm-950">
      <div className="container-page py-4 pb-[calc(env(safe-area-inset-bottom)+6.5rem)] md:pb-4">
        {/* Mobile nav is h-16 (64px). Bottom padding of 6.5rem (104px) + py-4 (1rem) ensures no overlap */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4 lg:grid-cols-5">
          {/* Brand */}
          <div className="space-y-2">
            <Link href="/" className="flex items-center gap-1.5">
              <BrandLogo size="sm" />
            </Link>
            <p className="text-xs text-muted-foreground max-w-xs">
              Promote products, services, and trusted brands with verification-first visibility.
            </p>
          </div>

          {/* Marketplace */}
          <div className="space-y-2">
            <h4 className="font-display font-semibold text-xs">Marketplace</h4>
            <nav aria-label="Marketplace" className="flex flex-col gap-1.5">
              <Link
                href="/mzansi-market"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Mzansi Market
              </Link>
              <Link
                href="/mzansi-business"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Mzansi Business
              </Link>
              <Link
                href="/promotions"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Promotions & Events
              </Link>
              <Link
                href="/advertise"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Advertise
              </Link>
            </nav>
          </div>

          {/* Safety */}
          <div className="space-y-2">
            <h4 className="font-display font-semibold text-xs">Safety</h4>
            <nav aria-label="Safety" className="flex flex-col gap-1.5">
              <Link
                href="/safety/scam-alerts"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Scam Alerts
              </Link>
              <Link
                href="/safety/meeting-checklist"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Meeting Safety
              </Link>
              <Link
                href="/verify-buyer"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Verify a Buyer
              </Link>
            </nav>
          </div>

          {/* Legal */}
          <div className="space-y-2">
            <h4 className="font-display font-semibold text-xs">Legal</h4>
            <nav aria-label="Legal" className="flex flex-col gap-1.5">
              <Link
                href="/privacy"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Privacy Policy
              </Link>
              <Link
                href="/terms"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Terms of Service
              </Link>
              <Link
                href="/dsar"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Data Request (POPIA)
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
