import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { MobileNav } from "@/components/layout/mobile-nav";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col pb-16 md:pb-0">
      <Header />
      <main className="flex-1 flex flex-col items-center justify-center gap-4 px-4 text-center">
        <Search className="h-8 w-8 text-muted-foreground" />
        <div className="space-y-2">
          <h1 className="text-2xl font-display font-bold">404 — Page Not Found</h1>
          <p className="text-muted-foreground max-w-md">
            This page doesn&apos;t exist or has been moved.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild variant="outline">
            <Link href="/">Go to Homepage</Link>
          </Button>
          <Button asChild>
            <Link href="/mzansi-market">Browse Marketplace</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/mzansi-market?focus=search">Search Listings</Link>
          </Button>
        </div>
      </main>
      <Footer />
      <MobileNav />
    </div>
  );
}
