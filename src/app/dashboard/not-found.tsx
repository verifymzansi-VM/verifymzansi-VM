import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardNotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-16 px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <Search className="h-7 w-7 text-muted-foreground" />
      </div>
      <div className="max-w-md space-y-2">
        <h1 className="text-lg sm:text-xl font-display font-bold">Page Not Found</h1>
        <p className="text-sm text-muted-foreground">
          This dashboard page doesn&apos;t exist or has been moved.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button asChild variant="outline">
          <Link href="/">Go to homepage</Link>
        </Button>
        <Button asChild>
          <Link href="/dashboard">Back to Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
