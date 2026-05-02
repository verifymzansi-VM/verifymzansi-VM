import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { MobileNav } from "@/components/layout/mobile-nav";

export default function MarketplaceNotFound() {
  return (
    <div className="flex min-h-screen flex-col pb-16 md:pb-0">
      <Header />
      <main className="flex-1 flex flex-col items-center justify-center gap-6 px-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <Search className="h-7 w-7 text-muted-foreground" />
        </div>
        <div className="max-w-md space-y-2">
          <h1 className="text-lg sm:text-xl font-display font-bold">Not Found</h1>
          <p className="text-sm text-muted-foreground">
            This listing, business, or Tourism & Events post could not be found. It may have been
            removed or the link is incorrect.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild variant="outline">
            <Link href="/">Go to homepage</Link>
          </Button>
          <Button asChild>
            <Link href="/mzansi-market">Browse Listings</Link>
          </Button>
        </div>
      </main>
      <Footer />
      <MobileNav />
    </div>
  );
}
