import Link from "next/link";
import { KeyRound } from "lucide-react";
import { AuthIconTile, AuthPageHeader } from "@/components/auth/auth-ui";
import { Button } from "@/components/ui/button";

export default function AuthNotFound() {
  return (
    <div className="space-y-6">
      <AuthPageHeader
        icon={
          <AuthIconTile>
            <KeyRound />
          </AuthIconTile>
        }
        title="Page not found"
        description="This account page doesn't exist."
      />
      <div className="flex flex-col gap-3">
        <Button asChild variant="trust-verified" size="lg" className="h-11 w-full text-[15px]">
          <Link href="/login">Sign in</Link>
        </Button>
        <Button asChild variant="outline" size="lg" className="h-11 w-full text-[15px]">
          <Link href="/">Go to homepage</Link>
        </Button>
      </div>
    </div>
  );
}
