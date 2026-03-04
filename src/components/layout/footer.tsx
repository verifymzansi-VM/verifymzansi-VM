import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Separator } from "@/components/ui/separator";

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t bg-warm-50 dark:bg-warm-950">
      <div className="container-page py-6 sm:py-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Brand */}
          <div className="space-y-3">
            <Link href="/" className="flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-brand-green" />
              <span className="font-display font-bold text-lg">
                Verify<span className="text-brand-green">Mzansi</span>
              </span>
            </Link>
            <p className="text-sm text-muted-foreground max-w-xs">
              SA&apos;s trusted marketplace. Buy, sell &amp; promote with verified users.
            </p>
          </div>

          {/* Marketplace */}
          <div className="space-y-3">
            <h4 className="font-display font-semibold text-sm">Marketplace</h4>
            <nav aria-label="Marketplace" className="flex flex-col gap-2">
              <Link
                href="/mzansi-market"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Mzansi Market
              </Link>
              <Link
                href="/mzansi-business"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Mzansi Business
              </Link>
              <Link
                href="/promotions"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Promotions & Events
              </Link>
            </nav>
          </div>

          {/* Safety */}
          <div className="space-y-3">
            <h4 className="font-display font-semibold text-sm">Safety</h4>
            <nav aria-label="Safety" className="flex flex-col gap-2">
              <Link
                href="/safety/scam-alerts"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Scam Alerts
              </Link>
              <Link
                href="/safety/meeting-checklist"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Meeting Safety
              </Link>
              <Link
                href="/verify-buyer"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Verify a Buyer
              </Link>
            </nav>
          </div>

          {/* Legal */}
          <div className="space-y-3">
            <h4 className="font-display font-semibold text-sm">Legal</h4>
            <nav aria-label="Legal" className="flex flex-col gap-2">
              <Link
                href="/privacy"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Privacy Policy
              </Link>
              <Link
                href="/terms"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Terms of Service
              </Link>
              <Link
                href="/dsar"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Data Request (POPIA)
              </Link>
            </nav>
          </div>
        </div>

        <Separator className="my-5 sm:my-6" />

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <p>&copy; {currentYear} VerifyMzansi. All rights reserved.</p>
          <div className="flex items-center gap-1">
            <span className="inline-block w-4 h-3 rounded-sm overflow-hidden">
              {/* SA flag mini icon — CSS gradient */}
              <span
                className="block w-full h-full"
                style={{
                  background:
                    "linear-gradient(180deg, #DE3831 0%, #DE3831 17%, #fff 17%, #fff 33%, #00833E 33%, #00833E 50%, #FFB81C 50%, #FFB81C 67%, #002395 67%, #002395 83%, #000 83%, #000 100%)",
                }}
              />
            </span>
            <span>Made in South Africa</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
