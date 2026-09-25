import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCapabilityFromDb } from "@/lib/auth/admin-access";
import { resolveCommercialSettings } from "@/lib/commercial/settings";
import {
  PartnersPanel,
  type AdminCommission,
  type AdminPartner,
} from "@/components/admin/commercial/partners-panel";

export const metadata = { title: "Partners & Commission" };
export const dynamic = "force-dynamic";

export default async function PartnersAdminPage() {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/login");
  if (!(await verifyCapabilityFromDb(user, "partners:manage"))) redirect("/admin");

  const admin = createAdminClient();
  const [partners, commissions, acquisition, settings] = await Promise.all([
    admin
      .from("partners")
      .select("id, user_id, code, status, commission_bps")
      .order("created_at", { ascending: false }),
    admin
      .from("commissions")
      .select(
        "id, partner_id, payment_id, base_cents, amount_cents, rate_bps, status, requires_manual_approval, eligible_at, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(200),
    admin.from("account_acquisition").select("partner_id").not("partner_id", "is", null),
    admin.from("commercial_settings").select("key, value"),
  ]);
  if (partners.error || commissions.error) throw new Error("Unable to load partners");

  const partnerRows = partners.data ?? [];
  const profiles = partnerRows.length
    ? await admin
        .from("account_profiles")
        .select("user_id, display_name")
        .in(
          "user_id",
          partnerRows.map((p) => p.user_id)
        )
    : { data: [] as Array<{ user_id: string; display_name: string | null }> };
  const paymentIds = (commissions.data ?? []).map((c) => c.payment_id);
  const payments = paymentIds.length
    ? await admin.from("payments").select("id, status").in("id", paymentIds)
    : { data: [] as Array<{ id: string; status: string }> };

  const rows: AdminPartner[] = partnerRows.map((p) => ({
    ...p,
    displayName:
      (profiles.data ?? []).find((profile) => profile.user_id === p.user_id)?.display_name ?? null,
    referrals: (acquisition.data ?? []).filter((a) => a.partner_id === p.id).length,
  }));
  const commissionRows: AdminCommission[] = (commissions.data ?? []).map((c) => ({
    ...c,
    partnerCode: partnerRows.find((p) => p.id === c.partner_id)?.code ?? "?",
    paymentStatus: (payments.data ?? []).find((pay) => pay.id === c.payment_id)?.status ?? null,
  }));

  return (
    <div className="space-y-6 p-4">
      <h1 className="text-2xl font-bold">Partners &amp; Commission</h1>
      <PartnersPanel
        partners={rows}
        commissions={commissionRows}
        defaultRateBps={resolveCommercialSettings(settings.data).partner.commissionBps}
        appUrl={process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com"}
      />
    </div>
  );
}
