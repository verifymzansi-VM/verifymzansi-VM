import Link from "next/link";
import { Fingerprint, LifeBuoy, LockKeyhole, MessageSquareText } from "lucide-react";
import { BrandMark, BrandPointCards, BrandSurface, VerificationEmblem } from "@/components/brand";

export const metadata = {
  title: "Account",
  description:
    "Sign in or create a VerifyMzansi account to post marketplace listings, business services, tourism offers, venues, and events.",
  robots: { index: false, follow: false },
};

const PANEL_POINTS = [
  { icon: Fingerprint, title: "Phone and ID checked before posting" },
  { icon: MessageSquareText, title: "Enquiries in one dashboard" },
  { icon: LockKeyhole, title: "Documents kept private" },
] as const;

/**
 * Auth shell. Mobile: a focused single column with the logo on top. Desktop:
 * the form on the right and a deep-green panel on the left with three short
 * trust points. Spacing is kept tight so the sign-in form fits one screen.
 * The panel comes after <main> in the DOM so keyboard and screen-reader users
 * reach the form first.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <div className="bg-hero-mesh relative flex min-w-0 flex-1 flex-col">
        <div
          aria-hidden="true"
          className="mzansi-pattern pointer-events-none absolute inset-x-0 top-0 h-56 opacity-[0.035] [mask-image:linear-gradient(to_bottom,black,transparent)] dark:opacity-[0.025] dark:invert"
        />

        <div className="relative flex items-center justify-between gap-4 px-4 pt-3 sm:px-8 sm:pt-5 lg:justify-end">
          <Link
            href="/"
            aria-label="VerifyMzansi home"
            className="-m-1 rounded-xl p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
          >
            <BrandMark priority decorative />
          </Link>
          <Link
            href="/contact"
            prefetch={false}
            className="inline-flex min-h-11 items-center gap-2 rounded-full px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <LifeBuoy className="h-4 w-4" aria-hidden="true" />
            Help
          </Link>
        </div>

        <main
          id="main-content"
          className="relative flex flex-1 scroll-mt-24 justify-center px-4 pb-6 pt-3 sm:items-center sm:px-8 sm:py-6"
        >
          <div className="w-full max-w-[25rem]">
            <div className="sm:rounded-3xl sm:border sm:border-border/70 sm:bg-card sm:p-7 sm:elev-md">
              {children}
            </div>
          </div>
        </main>

        <footer className="relative px-4 pb-4 sm:px-8">
          <nav
            aria-label="Legal and support"
            className="flex flex-wrap items-center justify-center gap-x-1 text-[13px] text-muted-foreground"
          >
            <Link
              href="/terms"
              className="inline-flex min-h-11 items-center rounded-md px-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Terms of Service
            </Link>
            <Link
              href="/privacy"
              className="inline-flex min-h-11 items-center rounded-md px-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Privacy Policy
            </Link>
            <Link
              href="/contact"
              className="inline-flex min-h-11 items-center rounded-md px-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Contact us
            </Link>
          </nav>
        </footer>
      </div>

      <BrandSurface
        as="aside"
        aria-labelledby="auth-panel-title"
        className="hidden lg:sticky lg:top-0 lg:order-first lg:flex lg:h-screen lg:w-[46%] xl:w-1/2"
      >
        <div className="relative flex w-full flex-col gap-6 overflow-y-auto p-8 pb-10 xl:px-12 xl:py-10">
          <Link
            href="/"
            aria-label="VerifyMzansi home"
            className="self-start rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <BrandMark inverse decorative />
          </Link>

          <div className="flex min-h-[18rem] flex-1 items-center justify-center">
            <VerificationEmblem />
          </div>

          <div>
            <h2
              id="auth-panel-title"
              className="max-w-[28rem] font-display text-[1.875rem] font-bold leading-[1.08] tracking-[-0.03em] xl:text-[2.25rem]"
            >
              Trade with people who&apos;ve been{" "}
              <span className="text-brand-gold-300">checked.</span>
            </h2>
            <BrandPointCards points={PANEL_POINTS} className="mt-6" />
          </div>
        </div>
      </BrandSurface>
    </div>
  );
}
