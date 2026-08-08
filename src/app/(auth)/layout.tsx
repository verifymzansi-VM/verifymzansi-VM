import Link from "next/link";
import { ShieldCheck, BadgeCheck, LockKeyhole } from "lucide-react";
import { BrandLogo } from "@/components/shared/brand-logo";

export const metadata = {
  title: "Account",
  description:
    "Sign in or create a VerifyMzansi account to post marketplace listings, business services, tourism offers, venues, and events.",
  robots: { index: false, follow: false },
};

const BRAND_POINTS = [
  {
    icon: ShieldCheck,
    colorClass: "bg-brand-green/10 text-brand-green",
    title: "Identity-reviewed members",
    detail: "Phone, ID evidence, selfie, and location checks before badges are earned.",
  },
  {
    icon: BadgeCheck,
    colorClass: "bg-brand-gold/15 text-brand-gold-700 dark:text-brand-gold-300",
    title: "Trust badges on every post",
    detail: "See who completed verification before you meet, pay, or share details.",
  },
  {
    icon: LockKeyhole,
    colorClass: "bg-brand-blue/10 text-brand-blue",
    title: "POPIA-grade data care",
    detail: "Sensitive evidence is encrypted, access-logged, and never shown publicly.",
  },
] as const;

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {/* Left — brand panel (hidden on mobile) */}
      <div className="relative hidden lg:flex lg:w-1/2 items-center justify-center overflow-hidden bg-[linear-gradient(160deg,#f8f5ec_0%,#edf5ef_48%,#f7f3e8_100%)] p-12 dark:bg-[linear-gradient(160deg,#161310_0%,#0e1a12_48%,#161310_100%)]">
        {/* Decorative glows */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-brand-green/15 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-28 -right-20 h-96 w-96 rounded-full bg-brand-gold/15 blur-3xl"
        />

        <div className="relative z-10 max-w-md space-y-8">
          <Link href="/" aria-label="VerifyMzansi — Home" className="inline-block">
            <BrandLogo
              size="xl"
              priority
              imageClassName="drop-shadow-[0_24px_48px_rgba(0,0,0,0.16)]"
            />
          </Link>

          <div className="space-y-4">
            <h1 className="font-display text-4xl font-bold leading-[1.1] tracking-tight text-slate-900 dark:text-white">
              Trade with people you can check.
            </h1>
            <p className="text-lg leading-relaxed text-muted-foreground">
              Post and manage trusted local listings, business services, tourism, and events.
            </p>
          </div>

          <ul className="space-y-4">
            {BRAND_POINTS.map((point) => (
              <li key={point.title} className="flex items-start gap-3">
                <span
                  className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${point.colorClass}`}
                >
                  <point.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">{point.title}</p>
                  <p className="text-sm text-muted-foreground">{point.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Right — auth form */}
      <main
        id="main-content"
        className="flex flex-1 items-center justify-center p-6 sm:p-8 lg:p-10 scroll-mt-24"
      >
        <div className="w-full max-w-md space-y-4">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8">
            <Link href="/" className="flex flex-col items-center justify-center gap-4 w-full">
              <BrandLogo
                size="lg"
                priority
                imageClassName="drop-shadow-[0_14px_28px_rgba(0,0,0,0.12)]"
              />
            </Link>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
