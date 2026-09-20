import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCapabilityFromDb } from "@/lib/auth/admin-access";
import { TrialManagement } from "@/components/admin/trial-management";
import { z } from "zod";

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
  const search = typeof params.account === "string" ? params.account.trim().slice(0, 100) : "";
  let accounts: { user_id: string; display_name: string; remaining: number }[] = [];
  if (search) {
    const query = admin.from("account_profiles").select("user_id,display_name").limit(20);
    const result = await (z.uuid().safeParse(search).success
      ? query.eq("user_id", search)
      : query
          .ilike("display_name", `%${search.replace(/[\\%_]/g, "\\$&")}%`)
          .order("display_name"));
    if (result.error) throw new Error("Unable to search accounts");
    accounts = await Promise.all(
      (result.data ?? []).map(async (account) => {
        const balance = await admin.rpc("account_free_posts_remaining", {
          p_user_id: account.user_id,
        });
        if (balance.error) throw new Error("Unable to load account free posts");
        return { ...account, remaining: balance.data as number };
      })
    );
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
