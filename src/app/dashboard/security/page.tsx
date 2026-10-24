import { redirect } from "next/navigation";
import { getDataBackend } from "@/lib/data-backend";
import {
  readFoundationServerSession,
  FoundationServerSessionError,
} from "@/lib/foundation/server-session";
import { StaffTwoStepClient } from "@/app/staff/two-step/two-step-client";
import { FoundationPasswordForm } from "@/components/auth/foundation-password-form";

export const metadata = { title: "Account security", robots: { index: false, follow: false } };

/** A fresh member can enrol before an administrator is explicitly appointed.
 * This page never creates or changes a role. */
export default async function AccountSecurityPage() {
  if (getDataBackend() !== "foundation") redirect("/dashboard/settings");
  let current: Awaited<ReturnType<typeof readFoundationServerSession>>;
  try {
    current = await readFoundationServerSession();
  } catch (error) {
    if (error instanceof FoundationServerSessionError && error.status === 401)
      redirect("/login?returnUrl=%2Fdashboard%2Fsecurity");
    redirect(
      error instanceof FoundationServerSessionError && error.status === 403
        ? "/error?reason=forbidden"
        : "/error?reason=unavailable"
    );
  }
  return (
    <section
      aria-labelledby="authenticator-heading"
      className="mx-auto max-w-md space-y-6 px-4 py-8"
    >
      <h1 id="authenticator-heading" className="font-display text-2xl font-bold">
        Account security
      </h1>
      <p>Use an authenticator app to set up or confirm a verification code for your account.</p>
      <StaffTwoStepClient next="/dashboard/security" friendlyName="VerifyMzansi account" />
      <FoundationPasswordForm
        key={current.account.account_id}
        accountId={current.account.account_id}
      />
    </section>
  );
}
