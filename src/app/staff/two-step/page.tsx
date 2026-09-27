import Link from "next/link";
import { requireStaff } from "@/lib/auth/require-staff";
import { sanitizeReturnUrl } from "@/lib/utils/navigation";
import { formatSaLongDate } from "@/lib/utils/format";
import { BrandLogo } from "@/components/shared/brand-logo";
import { StaffTwoStepClient } from "./two-step-client";

export const metadata = {
  title: "Two-step verification",
  robots: { index: false, follow: false },
};

/** Only return to back-office pages after verifying. */
function safeNext(value: string | undefined): string {
  const next = sanitizeReturnUrl(value);
  return next === "/admin" || next.startsWith("/admin/") ? next : "/admin";
}

export default async function StaffTwoStepPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; confirm?: string }>;
}) {
  const session = await requireStaff(undefined, { allowPendingMfa: true });
  const params = await searchParams;
  const next = safeNext(params.next);
  const confirming = params.confirm === "1";
  const graceEndsAt = session.mfa.status === "grace" ? session.mfa.graceEndsAt : null;

  return (
    <main id="main-content" className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto w-full max-w-md space-y-6">
        <BrandLogo size="sm" />
        <div className="space-y-2">
          <h1 className="font-display text-2xl font-bold">
            {confirming ? "Confirm it's you" : "Two-step verification"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {confirming
              ? "Sensitive actions need a code from your authenticator app from the last 15 minutes."
              : "Staff accounts use an authenticator app code as well as a password."}
            {graceEndsAt && !confirming && (
              <> You have until {formatSaLongDate(graceEndsAt)} to set this up.</>
            )}
          </p>
        </div>

        <StaffTwoStepClient next={next} />

        {graceEndsAt && !confirming && (
          <Link href={next} className="inline-block text-sm underline">
            Set up later
          </Link>
        )}
      </div>
    </main>
  );
}
