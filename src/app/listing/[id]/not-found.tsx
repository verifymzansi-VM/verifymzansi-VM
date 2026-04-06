import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";

export default function ListingNotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1 flex flex-col items-center justify-center gap-4 px-4 text-center">
        <Search className="h-8 w-8 text-muted-foreground" />
        <div className="space-y-2">
          <h1 className="text-2xl font-display font-bold">Listing Not Found</h1>
          <p className="text-muted-foreground max-w-md">
            This listing may have been removed, sold, or the link is incorrect.
          </p>
        </div>
        <div className="flex w-full max-w-sm flex-col gap-3 sm:flex-row">
          <Button asChild variant="outline" className="h-11 w-full sm:w-auto">
            <Link href="/">Go to Homepage</Link>
          </Button>
          <Button asChild className="h-11 w-full sm:w-auto">
            <Link href="/mzansi-market">Browse Listings</Link>
          </Button>
        </div>
      </main>
      <Footer />
    </div>
  );
}
