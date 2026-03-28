import Link from "next/link";
import { BrandLogo } from "@/components/shared/brand-logo";

export const metadata = {
  title: "Account",
  description: "Sign in, register, or manage your VerifyMzansi account.",
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {/* Left — brand panel (hidden on mobile) */}
      <div className="hidden lg:flex lg:w-1/2 bg-hero-mesh items-center justify-center p-12 relative overflow-hidden">
        <div className="relative z-10 max-w-md space-y-6 text-center">
          <Link href="/" className="flex flex-col items-center justify-center gap-6 w-full">
            <BrandLogo
              size="xl"
              priority
              imageClassName="drop-shadow-[0_24px_48px_rgba(0,0,0,0.16)]"
            />
          </Link>
          <p className="text-lg text-muted-foreground">
            South Africa&apos;s verification-first marketplace.
            <br />
            Buy &amp; sell with people you can trust.
          </p>
          <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground mt-4">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-brand-green" />
              4-step verification
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-brand-gold" />
              Trust scores
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-brand-blue" />
              POPIA compliant
            </span>
          </div>
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
