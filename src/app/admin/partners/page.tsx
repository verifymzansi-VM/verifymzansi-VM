import { requireStaff } from "@/lib/auth/require-staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCommercialSettings } from "@/lib/commercial/settings";
import { PageHeader } from "@/components/layout/page-header";
import { redirect } from "next/navigation";
import { getDataBackend } from "@/lib/data-backend";
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

async function readSourcePartners() {
  const admin = createAdminClient();
  const [partners, commissions, settings] = await Promise.all([
    admin
      .from("partners")
      .select("id, user_id, code, status, commission_bps")
      .order("created_at", { ascending: false })
      .limit(500),
    admin
      .from("commissions")
      .select(
        "id, partner_id, payment_id, base_cents, amount_cents, rate_bps, status, requires_manual_approval, eligible_at, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(200),
    admin.from("commercial_settings").select("key, value"),
  ]);
  if (partners.error || commissions.error) throw new Error("Unable to load partners");

  const partnerRows = partners.data ?? [];
  const paymentIds = (commissions.data ?? []).map((c) => c.payment_id);
  // Names, referral counts and payment states in one read each.
  const [profiles, referralCounts, payments] = await Promise.all([
    partnerRows.length
      ? admin
          .from("account_profiles")
          .select("user_id, display_name")
          .in(
            "user_id",
            partnerRows.map((p) => p.user_id)
          )
      : Promise.resolve({ data: [] as Array<{ user_id: string; display_name: string | null }> }),
    partnerRows.length
      ? admin.rpc("partner_referral_counts", { p_ids: partnerRows.map((p) => p.id) })
      : Promise.resolve({ data: [] }),
    paymentIds.length
      ? admin.from("payments").select("id, status").in("id", paymentIds)
      : Promise.resolve({ data: [] as Array<{ id: string; status: string }> }),
  ]);
  const nameByUser = new Map((profiles.data ?? []).map((p) => [p.user_id, p.display_name]));
  const referralsByPartner = new Map(
    ((referralCounts.data ?? []) as Array<{ partner_id: string; referrals: number }>).map((r) => [
      r.partner_id,
      r.referrals,
    ])
  );
  const codeByPartner = new Map(partnerRows.map((p) => [p.id, p.code]));
  const statusByPayment = new Map((payments.data ?? []).map((pay) => [pay.id, pay.status]));

  const rows: AdminPartner[] = partnerRows.map((p) => ({
    ...p,
    displayName: nameByUser.get(p.user_id) ?? null,
    referrals: referralsByPartner.get(p.id) ?? 0,
  }));
  const commissionRows: AdminCommission[] = (commissions.data ?? []).map((c) => ({
    ...c,
    partnerCode: codeByPartner.get(c.partner_id) ?? "?",
    paymentStatus: statusByPayment.get(c.payment_id) ?? null,
  }));
  return {
    rows,
    commissionRows,
    defaultRateBps: resolveCommercialSettings(settings.data).partner.commissionBps,
  };
}

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
  const native = getDataBackend() === "foundation";
  const { rows, commissionRows, defaultRateBps } = native
    ? await readNativePartners(user.id)
    : await readSourcePartners();
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
        nativeRetailOnly={native}
        appUrl={process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com"}
      />
    </div>
  );
}
