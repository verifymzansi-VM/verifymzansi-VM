import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col pb-16 md:pb-0">
      <Header />
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="hero-panel flex w-full max-w-lg flex-col items-center gap-6 px-6 py-10 text-center sm:px-10">
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl border border-border/60 bg-muted/60 shadow-xs">
            <Search className="h-8 w-8 text-brand-green" aria-hidden="true" />
          </div>
          <div className="max-w-md space-y-3">
            <p className="section-kicker">404</p>
            <h1 className="text-xl sm:text-2xl font-display font-bold tracking-tight">
              Page not found
            </h1>
            <p className="text-sm leading-6 text-muted-foreground">
              This page doesn&apos;t exist or has been moved.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/">Go to homepage</Link>
            </Button>
            <Button asChild variant="trust-verified" className="rounded-full font-semibold">
              <Link href="/mzansi-market">Browse Marketplace</Link>
            </Button>
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/mzansi-market?focus=search">Search Listings</Link>
            </Button>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
