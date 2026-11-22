import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/require-staff";
import { PageHeader } from "@/components/layout/page-header";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { readFreeCredits } from "@/lib/foundation/free-credits";
import { FoundationStaffCommandError } from "@/lib/foundation/staff-command";
import { staffVerifyHref } from "@/lib/auth/staff-mfa-links";
import { createLogger } from "@/lib/utils/logger";
import type { FreeCredit } from "@/lib/admin/free-credits";
import { FreeCreditsClient } from "./free-credits-client";

export const metadata = {
  title: "Free credits — Admin",
  description: "Give ID-verified members free posts for a short time.",
};

const PATH = "/admin/free-credits";

export default async function FreeCreditsPage() {
  await requireStaff("free_credit:view");
  let gifts: FreeCredit[];
  try {
    const { api } = await readFoundationServerSession();
    gifts = await readFreeCredits(api);
  } catch (error) {
    if (error instanceof FoundationStaffCommandError && error.mfaRequired)
      redirect(staffVerifyHref("/staff/two-step", PATH));
    createLogger("FreeCreditsPage").error("Free credits read failed");
    return (
      <div className="space-y-6">
        <Header />
        <p role="alert">
          Free credits could not be loaded. Refresh to try again. This does not mean there are no
          gifts.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <Header />
      <FreeCreditsClient gifts={gifts} />
    </div>
  );
}

function Header() {
  return (
    <PageHeader
      title="Free credits"
      description="Free posts for businesses you recruit. Never charged, never renewed."
      breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Free credits" }]}
    />
  );
}
