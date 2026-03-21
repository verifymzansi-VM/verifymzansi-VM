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
      <main className="flex-1 flex flex-col items-center justify-center gap-4 px-4 text-center">
        <Search className="h-8 w-8 text-muted-foreground" />
        <div className="space-y-2">
          <h1 className="text-2xl font-display font-bold">Not Found</h1>
          <p className="text-muted-foreground max-w-md">
            This listing, business, or promotion could not be found. It may have been removed or the
            link is incorrect.
          </p>
        </div>
        <div className="flex gap-3">
          <Button asChild variant="outline">
            <Link href="/">Go Home</Link>
          </Button>
          <Button asChild>
            <Link href="/mzansi-market">Browse Marketplace</Link>
          </Button>
        </div>
      </main>
      <Footer />
      <MobileNav />
    </div>
  );
}
