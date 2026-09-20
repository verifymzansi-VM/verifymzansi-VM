import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCapabilityFromDb } from "@/lib/auth/admin-access";
import { TrialManagement } from "@/components/admin/trial-management";

export const metadata = { title: "Free Posts & Trials" };
export default async function TrialManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/login");
  if (!(await verifyCapabilityFromDb(user, "trials:manage"))) redirect("/admin");
  const admin = createAdminClient();
  const params = await searchParams;
  const search = typeof params.account === "string" ? params.account.trim().slice(0, 254) : "";
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
  const [campaigns, claims, summary] = await Promise.all([
    admin.from("intro_trial_campaigns").select("*"),
    admin
      .from("intro_trial_claims")
      .select(
        "id,user_id,area,content_id,duration_days,admin_granted,activated_at,expires_at,released_at,converted_at"
      )
      .order("created_at", { ascending: false })
      .limit(100),
    admin.rpc("intro_trial_summary"),
  ]);
  if (campaigns.error || claims.error || summary.error)
    throw new Error("Unable to load trial management");
  return (
    <TrialManagement
      campaigns={campaigns.data ?? []}
      claims={claims.data ?? []}
      summary={summary.data ?? []}
      accounts={accounts}
      accountSearch={search}
    />
  );
}
