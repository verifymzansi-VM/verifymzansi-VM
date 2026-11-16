import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { BrandLogo } from "@/components/shared/brand-logo";

/** The checkout pages' frame: the logo and "Secure checkout" bar, and the
 * patterned main area the checkout card sits in. */
export function CheckoutShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border/60 bg-card/80">
        <div className="container-page flex h-16 items-center justify-between gap-4">
          <Link
            href="/"
            aria-label="VerifyMzansi home"
            className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BrandLogo size="sm" />
          </Link>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground sm:text-sm">
            <LockKeyhole
              aria-hidden="true"
              className="h-4 w-4 text-brand-green-700 dark:text-brand-gold-300"
            />
            Secure checkout
          </span>
        </div>
      </header>

      <main
        id="main-content"
        className="bg-hero-mesh flex flex-1 scroll-mt-24 justify-center px-4 py-6 sm:items-center sm:py-8"
      >
        {children}
      </main>
    </div>
  );
}
