import { requireStaff } from "@/lib/auth/require-staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCommercialSettings } from "@/lib/commercial/settings";
import { PageHeader } from "@/components/layout/page-header";
import {
  PartnersPanel,
  type AdminCommission,
  type AdminPartner,
} from "@/components/admin/commercial/partners-panel";

export const metadata = { title: "Partners & Commission" };
export const dynamic = "force-dynamic";

export default async function PartnersAdminPage() {
  await requireStaff("partners:manage");

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
        defaultRateBps={resolveCommercialSettings(settings.data).partner.commissionBps}
        appUrl={process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com"}
      />
    </div>
  );
}
