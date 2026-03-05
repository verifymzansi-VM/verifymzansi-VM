import Image from "next/image";
import Link from "next/link";

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
          <Link href="/" className="inline-flex items-center justify-center gap-4 w-full">
            <Image
              src="/icons/icon-192.png?v=7"
              alt="VerifyMzansi Shield"
              width={80}
              height={80}
              className="object-contain drop-shadow-md"
            />
            <span className="font-display text-5xl font-bold tracking-tight">
              Verify<span className="text-brand-green">Mzansi</span>
            </span>
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
        <div className="grain-overlay" />
      </div>

      {/* Right — auth form */}
      <div className="flex flex-1 items-center justify-center p-6 sm:p-8 lg:p-10">
        <div className="w-full max-w-md space-y-4">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8">
            <Link href="/" className="flex flex-col items-center justify-center gap-3 w-full">
              <Image
                src="/icons/icon-192.png?v=7"
                alt="VerifyMzansi Shield"
                width={72}
                height={72}
                className="object-contain drop-shadow-md"
              />
              <span className="font-display text-3xl font-bold tracking-tight mt-1">
                Verify<span className="text-brand-green">Mzansi</span>
              </span>
            </Link>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
