import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardNotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 px-4 text-center">
      <Search className="h-8 w-8 text-muted-foreground" />
      <div className="space-y-2">
        <h1 className="text-2xl font-display font-bold">Page Not Found</h1>
        <p className="text-muted-foreground max-w-md">
          This dashboard page doesn&apos;t exist or has been moved.
        </p>
      </div>
      <Button asChild>
        <Link href="/dashboard">Back to Dashboard</Link>
      </Button>
    </div>
  );
}
