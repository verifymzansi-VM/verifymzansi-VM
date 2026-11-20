import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/require-staff";
import { PageHeader } from "@/components/layout/page-header";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { readMemberInvitations } from "@/lib/foundation/member-invitations";
import { FoundationStaffCommandError } from "@/lib/foundation/staff-command";
import { staffVerifyHref } from "@/lib/auth/staff-mfa-links";
import { sanitizeAppUrl } from "@/lib/services/email-template";
import { createLogger } from "@/lib/utils/logger";
import { MemberInvitationsClient } from "./member-invitations-client";

export const metadata = {
  title: "Member invitations — Admin",
  description: "Invite people to create a normal member account.",
};

const PATH = "/admin/member-invitations";

export default async function MemberInvitationsPage() {
  await requireStaff("member:invite");
  let data: Awaited<ReturnType<typeof readMemberInvitations>>;
  try {
    const { api } = await readFoundationServerSession();
    data = await readMemberInvitations(api);
  } catch (error) {
    if (error instanceof FoundationStaffCommandError && error.mfaRequired)
      redirect(staffVerifyHref("/staff/two-step", PATH));
    createLogger("MemberInvitationsPage").error("Member invitations read failed");
    return (
      <div className="space-y-6">
        <Header mode={null} />
        <p role="alert">
          Member invitations could not be loaded. Refresh to try again. This does not mean there are
          no invitations.
        </p>
      </div>
    );
  }
  const appUrl = sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  return (
    <div className="space-y-6">
      <Header mode={data.mode} />
      <MemberInvitationsClient
        invitations={data.items}
        registerUrl={`${appUrl}/register`}
        loginUrl={`${appUrl}/login`}
      />
    </div>
  );
}

function Header({ mode }: { mode: "invite_only" | "open" | null }) {
  const staffRoles = (
    <Link
      href="/admin/governance/roles"
      className="font-medium text-foreground underline underline-offset-4"
    >
      Staff roles
    </Link>
  );
  return (
    <PageHeader
      title="Member invitations"
      description={
        mode === "open" ? (
          <>
            Sign-up is open to everyone, so invitations aren&apos;t needed. To make someone staff,
            use {staffRoles}.
          </>
        ) : mode === "invite_only" ? (
          <>Sign-up is by invitation only. To make someone staff, use {staffRoles}.</>
        ) : (
          <>To make someone staff, use {staffRoles}.</>
        )
      }
      breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Member invitations" }]}
    />
  );
}
