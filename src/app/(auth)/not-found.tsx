import Link from "next/link";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AuthNotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <KeyRound className="h-7 w-7 text-muted-foreground" />
      </div>
      <div className="max-w-sm space-y-2">
        <h1 className="text-lg sm:text-xl font-display font-bold">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          This account page doesn&apos;t exist. Try signing in or creating an account.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button variant="outline" asChild>
          <Link href="/">Go to homepage</Link>
        </Button>
        <Button asChild>
          <Link href="/login">Sign In</Link>
        </Button>
      </div>
    </div>
  );
}
