import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardNotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-5 py-16 text-center">
      <span aria-hidden="true" className="empty-state-icon">
        <Search className="h-6 w-6" />
      </span>
      <div className="space-y-1.5">
        <h1 className="font-display text-xl font-bold sm:text-2xl">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          This dashboard page doesn&apos;t exist or has moved.
        </p>
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <Button asChild variant="trust-verified" className="h-11 rounded-full px-5">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
        <Button asChild variant="outline" className="h-11 rounded-full px-5">
          <Link href="/">Go to homepage</Link>
        </Button>
      </div>
    </div>
  );
}
