import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1 flex flex-col items-center justify-center gap-6 px-4 text-center">
        <Search className="h-12 w-12 text-muted-foreground" />
        <div className="space-y-2">
          <h1 className="text-3xl font-display font-bold">404 — Page Not Found</h1>
          <p className="text-muted-foreground max-w-md">
            The page you&apos;re looking for doesn&apos;t exist or has been moved. Try searching the
            marketplace or head back home.
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
    </div>
  );
}
