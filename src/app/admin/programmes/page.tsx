import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCapabilityFromDb } from "@/lib/auth/admin-access";
import { resolveCommercialSettings } from "@/lib/commercial/settings";
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
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/login");
  if (!(await verifyCapabilityFromDb(user, "contracts:manage"))) redirect("/admin");

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
    accounts = await Promise.all(
      (
        (found.data ?? []) as Array<{ user_id: string; display_name: string; email: string | null }>
      ).map(async (row) => {
        const kind = await admin.rpc("trial_entitlement_for", { p_user: row.user_id });
        return { ...row, trialEntitlement: typeof kind.data === "string" ? kind.data : "NONE" };
      })
    );
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
  const assignments = entitlementRows.length
    ? await admin
        .from("slot_assignments")
        .select("entitlement_id")
        .is("released_at", null)
        .in(
          "entitlement_id",
          entitlementRows.map((row) => row.id)
        )
    : { data: [] as Array<{ entitlement_id: string }> };
  const members = entitlementRows.length
    ? await admin
        .from("slot_entitlement_members")
        .select("entitlement_id, user_id")
        .in(
          "entitlement_id",
          entitlementRows.map((row) => row.id)
        )
    : { data: [] as Array<{ entitlement_id: string; user_id: string }> };

  const names = new Map(
    ((profiles.data ?? []) as Array<{ user_id: string; display_name: string | null }>).map((p) => [
      p.user_id,
      p.display_name,
    ])
  );

  const rows: ProgrammeContract[] = contractRows.map((contract) => {
    const entitlement = entitlementRows.find((row) => row.contract_id === contract.id);
    return {
      ...contract,
      holderName: contract.user_id ? (names.get(contract.user_id) ?? null) : null,
      activeUsage: entitlement
        ? (assignments.data ?? []).filter((a) => a.entitlement_id === entitlement.id).length
        : 0,
      activationCount: entitlement?.activation_count ?? 0,
      delegateIds: entitlement
        ? (members.data ?? [])
            .filter((m) => m.entitlement_id === entitlement.id)
            .map((m) => m.user_id)
        : [],
    };
  });

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-2xl font-bold">Programmes &amp; Contracts</h1>
        <p className="text-sm text-muted-foreground">
          Invitation-only programmes. Every grant has a ceiling (slots and activations), never
          renews automatically, and consumes the person&apos;s one free programme unless an audited
          override is recorded.
        </p>
      </div>
      <ProgrammesPanel
        accounts={accounts}
        accountSearch={search}
        contracts={rows}
        settings={resolveCommercialSettings(settings.data)}
      />
    </div>
  );
}
