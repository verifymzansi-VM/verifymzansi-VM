import { requireStaff } from "@/lib/auth/require-staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCommercialSettings } from "@/lib/commercial/settings";
import { PageHeader } from "@/components/layout/page-header";
import {
  ProgrammesPanel,
  type ProgrammeAccount,
  type ProgrammeContract,
} from "@/components/admin/commercial/programmes-panel";

export const metadata = { title: "Programmes & Contracts" };
export const dynamic = "force-dynamic";

export default async function ProgrammesPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  const { user } = await requireStaff("contracts:manage");

  const admin = createAdminClient();
  const { account } = await searchParams;
  const search = typeof account === "string" ? account.trim().slice(0, 254) : "";

  let accounts: ProgrammeAccount[] = [];
  if (search) {
    const found = await admin.rpc("search_free_post_accounts", {
      p_actor_id: user.id,
      p_search: search,
    });
    if (found.error) throw new Error("Unable to search accounts");
    const matches = (found.data ?? []) as Array<{
      user_id: string;
      display_name: string;
      email: string | null;
    }>;
    // Trial entitlements for every result in one call.
    const kinds = matches.length
      ? await admin.rpc("trial_entitlements_for", { p_ids: matches.map((row) => row.user_id) })
      : { data: [] };
    const kindByUser = new Map(
      ((kinds.data ?? []) as Array<{ user_id: string; entitlement: string | null }>).map((k) => [
        k.user_id,
        k.entitlement,
      ])
    );
    accounts = matches.map((row) => ({
      ...row,
      trialEntitlement: kindByUser.get(row.user_id) ?? "NONE",
    }));
  }

  const [contracts, settings] = await Promise.all([
    admin
      .from("commercial_contracts")
      .select(
        "id, contract_type, user_id, organisation_id, title, status, slot_capacity, activation_limit_total, activation_limit_per_period, activation_period_days, admin_limit, price_cents, starts_at, ends_at, notes, features"
      )
      .order("created_at", { ascending: false })
      .limit(200),
    admin.from("commercial_settings").select("key, value"),
  ]);
  if (contracts.error || settings.error) throw new Error("Unable to load programmes");

  const contractRows = contracts.data ?? [];
  const contractIds = contractRows.map((row) => row.id);
  const userIds = [...new Set(contractRows.map((row) => row.user_id).filter(Boolean))] as string[];

  const [entitlements, profiles] = await Promise.all([
    contractIds.length
      ? admin
          .from("slot_entitlements")
          .select("id, contract_id, activation_count, slot_capacity")
          .in("contract_id", contractIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? admin.from("account_profiles").select("user_id, display_name").in("user_id", userIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const entitlementRows = (entitlements.data ?? []) as Array<{
    id: string;
    contract_id: string;
    activation_count: number;
  }>;
  const entitlementIds = entitlementRows.map((row) => row.id);
  const [assignments, members] = await Promise.all([
    entitlementIds.length
      ? admin
          .from("slot_assignments")
          .select("entitlement_id")
          .is("released_at", null)
          .in("entitlement_id", entitlementIds)
      : Promise.resolve({ data: [] as Array<{ entitlement_id: string }> }),
    entitlementIds.length
      ? admin
          .from("slot_entitlement_members")
          .select("entitlement_id, user_id")
          .in("entitlement_id", entitlementIds)
      : Promise.resolve({ data: [] as Array<{ entitlement_id: string; user_id: string }> }),
  ]);
  const entitlementByContract = new Map(entitlementRows.map((row) => [row.contract_id, row]));
  const usageByEntitlement = new Map<string, number>();
  for (const a of assignments.data ?? []) {
    usageByEntitlement.set(a.entitlement_id, (usageByEntitlement.get(a.entitlement_id) ?? 0) + 1);
  }
  const delegatesByEntitlement = new Map<string, string[]>();
  for (const m of members.data ?? []) {
    delegatesByEntitlement.set(m.entitlement_id, [
      ...(delegatesByEntitlement.get(m.entitlement_id) ?? []),
      m.user_id,
    ]);
  }

  const names = new Map(
    ((profiles.data ?? []) as Array<{ user_id: string; display_name: string | null }>).map((p) => [
      p.user_id,
      p.display_name,
    ])
  );

  const rows: ProgrammeContract[] = contractRows.map((contract) => {
    const entitlement = entitlementByContract.get(contract.id);
    return {
      ...contract,
      holderName: contract.user_id ? (names.get(contract.user_id) ?? null) : null,
      activeUsage: entitlement ? (usageByEntitlement.get(entitlement.id) ?? 0) : 0,
      activationCount: entitlement?.activation_count ?? 0,
      delegateIds: entitlement ? (delegatesByEntitlement.get(entitlement.id) ?? []) : [],
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Programmes & Contracts"
        description="Invitation-only programmes. Every grant has a ceiling (slots and activations), never renews automatically, and uses up the person's one free programme unless an audited override is recorded."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Programmes & Contracts" }]}
      />
      <ProgrammesPanel
        accounts={accounts}
        accountSearch={search}
        contracts={rows}
        settings={resolveCommercialSettings(settings.data)}
      />
    </div>
  );
}
