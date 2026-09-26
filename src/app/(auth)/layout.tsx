import Link from "next/link";
import { Fingerprint, LifeBuoy, LockKeyhole, MessageSquareText } from "lucide-react";
import { BrandLogo } from "@/components/shared/brand-logo";

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
 * the form on the right and a photo-led panel on the left with three short
 * trust points. The panel comes after <main> in the DOM
 * so keyboard and screen-reader users reach the form first.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <div className="bg-hero-mesh relative flex min-w-0 flex-1 flex-col">
        <div
          aria-hidden="true"
          className="mzansi-pattern pointer-events-none absolute inset-x-0 top-0 h-72 opacity-[0.035] [mask-image:linear-gradient(to_bottom,black,transparent)] dark:opacity-[0.025] dark:invert"
        />

        <div className="relative flex items-center justify-between gap-4 px-4 pt-4 sm:px-8 sm:pt-6 lg:justify-end">
          <Link
            href="/"
            aria-label="VerifyMzansi home"
            className="-m-1 rounded-xl p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
          >
            <BrandLogo size="md" priority />
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
          className="relative flex flex-1 scroll-mt-24 justify-center px-4 pb-8 pt-6 sm:items-center sm:px-8 sm:py-10"
        >
          <div className="w-full max-w-[27rem]">
            <div className="sm:rounded-3xl sm:border sm:border-border/70 sm:bg-card sm:p-8 sm:elev-md">
              {children}
            </div>
          </div>
        </main>

        <footer className="relative px-4 pb-6 sm:px-8">
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

      <aside
        aria-labelledby="auth-panel-title"
        className="relative hidden overflow-hidden bg-brand-green-950 text-white lg:sticky lg:top-0 lg:order-first lg:flex lg:h-screen lg:w-[46%] xl:w-1/2"
      >
        {/* CSS background rather than next/image: the panel is display:none on
            phones, so the photo is never downloaded there. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[url('/images/showrooms/market-v2-mobile.avif')] bg-cover bg-top"
        />
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-brand-green-950/70 to-transparent"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-brand-green-950 from-45% via-brand-green-950/80 via-65% to-transparent"
        />
        <div
          aria-hidden="true"
          className="mzansi-pattern pointer-events-none absolute inset-x-0 bottom-0 h-2/3 opacity-[0.06] invert [mask-image:linear-gradient(to_top,black,transparent)]"
        />

        <div className="relative flex w-full flex-col justify-between gap-10 overflow-y-auto p-10 xl:px-14 xl:py-12">
          <Link
            href="/"
            aria-label="VerifyMzansi home"
            className="self-start rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <BrandLogo size="md" tone="inverse" />
          </Link>

          <div className="max-w-[32rem]">
            <h2
              id="auth-panel-title"
              className="font-display text-[2.25rem] font-bold leading-[1.05] tracking-[-0.03em] xl:text-[2.75rem]"
            >
              Trade with people who&apos;ve been checked.
            </h2>

            <ul className="mt-8 space-y-3">
              {PANEL_POINTS.map(({ icon: Icon, title }) => (
                <li key={title} className="flex items-center gap-3.5 font-semibold text-white">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-brand-gold-300">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  {title}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>
    </div>
  );
}
