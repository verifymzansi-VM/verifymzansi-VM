import { requireStaff } from "@/lib/auth/require-staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { TrialManagement } from "@/components/admin/trial-management";
import {
  TrialExtensionsPanel,
  type AdminExtensionOffer,
  type ExtensionTarget,
  type NearCapacityProgramme,
} from "@/components/admin/trial-extensions-panel";
import { getCommercialSettings } from "@/lib/commercial/settings";

export const metadata = { title: "Free Posts & Trials" };

const CONTRACT_LABELS: Record<string, string> = {
  STRATEGIC_INDIVIDUAL: "Group 1 founding individual",
  FOUNDING_COMMERCIAL_PARTNER: "Group 2 founding partner",
};

export default async function TrialManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; offer?: string }>;
}) {
  const { user } = await requireStaff("trials:manage");
  const admin = createAdminClient();
  const params = await searchParams;
  const search = typeof params.account === "string" ? params.account.trim().slice(0, 254) : "";
  const initialOffer =
    typeof params.offer === "string" &&
    /^(organisation_trial|founding_contract|intro_trial_claim):[0-9a-f-]{36}$/i.test(params.offer)
      ? params.offer
      : null;
  let accounts: {
    user_id: string;
    display_name: string;
    email: string | null;
    remaining: number;
  }[] = [];
  if (search) {
    const result = await admin.rpc("search_free_post_accounts", {
      p_actor_id: user.id,
      p_search: search,
    });
    if (result.error) throw new Error("Unable to search accounts");
    accounts = result.data ?? [];
  }
  const nowIso = new Date().toISOString();
  const [campaigns, claims, summary, programmes, contracts, offers, settings] = await Promise.all([
    admin.from("intro_trial_campaigns").select("*"),
    admin
      .from("intro_trial_claims")
      .select(
        "id,user_id,area,content_id,duration_days,admin_granted,activated_at,expires_at,released_at,converted_at"
      )
      .order("created_at", { ascending: false })
      .limit(100),
    admin.rpc("intro_trial_summary"),
    admin
      .from("organisations")
      .select("id, name, slug, programme_status, trial_ends_at, sponsored_capacity")
      .in("programme_status", ["founding_trial", "active_paid"]),
    admin
      .from("commercial_contracts")
      .select("id, title, contract_type, user_id, ends_at")
      .in("contract_type", ["STRATEGIC_INDIVIDUAL", "FOUNDING_COMMERCIAL_PARTNER"])
      .eq("price_cents", 0)
      .eq("status", "active")
      .gt("ends_at", nowIso)
      .order("ends_at")
      .limit(200),
    admin
      .from("trial_extension_offers")
      .select(
        "id, target_type, target_label, kind, days, current_ends_at, proposed_ends_at, respond_by, reason, status, approval_required_because, offered_by, email_sends, created_at"
      )
      .in("status", ["pending_approval", "offered"])
      .order("created_at", { ascending: false }),
    getCommercialSettings(admin as never),
  ]);
  if (campaigns.error || claims.error || summary.error)
    throw new Error("Unable to load trial management");

  const orgRows = programmes.data ?? [];
  const sponsorships = orgRows.length
    ? await admin
        .from("organisation_sponsorships")
        .select("organisation_id, status")
        .in(
          "organisation_id",
          orgRows.map((o) => o.id)
        )
        .in("status", ["active", "waitlisted"])
    : { data: [] as Array<{ organisation_id: string; status: string }> };
  const nearCapacity: NearCapacityProgramme[] = orgRows
    .map((o) => {
      const rows = (sponsorships.data ?? []).filter((s) => s.organisation_id === o.id);
      return {
        id: o.id,
        name: o.name,
        capacity: o.sponsored_capacity,
        filled: rows.filter((s) => s.status === "active").length,
        waiting: rows.filter((s) => s.status === "waitlisted").length,
      };
    })
    .filter((p) => p.capacity > 0 && p.filled / p.capacity >= 0.8);

  const targets: ExtensionTarget[] = [
    ...orgRows
      .filter(
        (o) =>
          o.programme_status === "founding_trial" && o.trial_ends_at && o.trial_ends_at > nowIso
      )
      .map((o) => ({
        type: "organisation_trial" as const,
        id: o.id,
        label: o.name,
        detail: "Founding pilot",
        endsAt: o.trial_ends_at as string,
        href: `/admin/organisations/${o.id}`,
      })),
    ...(contracts.data ?? []).map((c) => ({
      type: "founding_contract" as const,
      id: c.id,
      label: c.title,
      detail: CONTRACT_LABELS[c.contract_type] ?? c.contract_type,
      endsAt: c.ends_at,
      href: "/admin/programmes",
    })),
    ...(claims.data ?? [])
      .filter(
        (t) =>
          t.duration_days === 30 &&
          t.activated_at &&
          !t.released_at &&
          !t.converted_at &&
          t.expires_at &&
          t.expires_at > nowIso
      )
      .map((t) => ({
        type: "intro_trial_claim" as const,
        id: t.id,
        label: `Introductory trial ${t.id.slice(0, 8)}`,
        detail: `30-day trial · ${t.area}`,
        endsAt: t.expires_at as string,
      })),
  ];

  const offerRows = offers.data ?? [];
  const offererIds = [...new Set(offerRows.map((o) => o.offered_by))];
  const offerers = offererIds.length
    ? await admin.from("account_profiles").select("user_id, display_name").in("user_id", offererIds)
    : { data: [] as Array<{ user_id: string; display_name: string | null }> };
  const adminOffers: AdminExtensionOffer[] = offerRows.map((o) => ({
    ...(o as Omit<AdminExtensionOffer, "offeredByName">),
    offeredByName:
      o.offered_by === user.id
        ? "you"
        : ((offerers.data ?? []).find((p) => p.user_id === o.offered_by)?.display_name ??
          "another administrator"),
  }));

  return (
    <div className="space-y-8">
      <TrialExtensionsPanel
        actorId={user.id}
        targets={targets}
        offers={adminOffers}
        nearCapacity={nearCapacity}
        initialTarget={initialOffer}
        defaultDays={settings.extensions.defaultDays}
      />
      <TrialManagement
        campaigns={campaigns.data ?? []}
        claims={claims.data ?? []}
        summary={summary.data ?? []}
        accounts={accounts}
        accountSearch={search}
      />
    </div>
  );
}
