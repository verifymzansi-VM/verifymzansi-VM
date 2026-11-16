import { requireStaff } from "@/lib/auth/require-staff";
import { PageHeader } from "@/components/layout/page-header";
import { redirect } from "next/navigation";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { readRestoredPartnerAdmin } from "@/lib/foundation/partners";
import { FoundationStaffCommandError } from "@/lib/foundation/staff-command";
import { staffVerifyHref } from "@/lib/auth/staff-mfa-links";
import {
  PartnersPanel,
  type AdminCommission,
  type AdminPartner,
} from "@/components/admin/commercial/partners-panel";

export const metadata = { title: "Partners & Commission" };
export const dynamic = "force-dynamic";

async function readNativePartners(actorId: string) {
  const { api } = await readFoundationServerSession();
  try {
    const data = await readRestoredPartnerAdmin(api, actorId);
    const rows: AdminPartner[] = data.partners.map((p) => ({
      id: p.id,
      user_id: p.account_id,
      code: p.code,
      status: p.status,
      commission_bps: p.commission_bps,
      displayName: p.display_name,
      referrals: p.referrals,
    }));
    const commissionRows: AdminCommission[] = data.commissions.map((c) => ({
      id: c.id,
      partner_id: c.partner_id,
      partnerCode: c.partner_code,
      base_cents: Number(c.base_cents),
      amount_cents: Number(c.amount_cents),
      rate_bps: c.rate_bps,
      status: c.status.toUpperCase(),
      requires_manual_approval: false,
      eligible_at: c.eligible_at,
      created_at: c.created_at,
      paymentStatus: c.payment_status,
    }));
    return { rows, commissionRows, defaultRateBps: data.default_rate_bps };
  } catch (error) {
    if (error instanceof FoundationStaffCommandError && error.mfaRequired)
      redirect(staffVerifyHref("/staff/two-step", "/admin/partners"));
    throw error;
  }
}

export default async function PartnersAdminPage() {
  const { user } = await requireStaff("partners:manage");
  const { rows, commissionRows, defaultRateBps } = await readNativePartners(user.id);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Partners & Commission"
        description="Partner codes, referred accounts and the commission each payment earns."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Partners & Commission" }]}
      />
      <PartnersPanel
        partners={rows}
        commissions={commissionRows}
        defaultRateBps={defaultRateBps}
        nativeRetailOnly
        appUrl={process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com"}
      />
    </div>
  );
}
