import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ACCOUNT_PROFILE_TABLE, applyOwnerFilter, getOwnerColumn } from "@/lib/account/compat";
import { LeadsFeed, type LeadRow } from "@/components/dashboard/leads-feed";

export const metadata = {
  title: "Leads",
  description: "View and manage buyer enquiries and leads for your listings.",
};

export default async function LeadsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: _profile } = await supabase
    .from(ACCOUNT_PROFILE_TABLE)
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  const leadsOwnerColumn = await getOwnerColumn(supabase, "leads");
  const leadsQuery = applyOwnerFilter(
    supabase
      .from("leads")
      .select(
        `
      id,
      target_id,
      target_type,
      message,
      status,
      buyer_name,
      buyer_email,
      buyer_phone,
      created_at
    `
      )
      .order("created_at", { ascending: false })
      .limit(50),
    leadsOwnerColumn,
    user.id
  );

  const { data: leads, error } = await leadsQuery;
  if (error) throw new Error("Unable to load enquiries. Please try again.");
  const rows = (leads ?? []) as unknown as LeadRow[];
  const titles = new Map<string, { title: string }>();
  await Promise.all(
    ["listing", "promotion"].map(async (type) => {
      const ids = [
        ...new Set(rows.filter((row) => row.target_type === type).map((row) => row.target_id)),
      ];
      if (!ids.length) return;
      const { data } = await supabase
        .from(type === "promotion" ? "promotions" : "listings")
        .select("id, title")
        .in("id", ids);
      for (const item of data ?? []) titles.set(`${type}:${item.id}`, { title: item.title });
    })
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        description="Buyer enquiries for your listings."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Leads" }]}
      />

      <LeadsFeed
        initialLeads={rows.map((row) => ({
          ...row,
          listings: titles.get(`${row.target_type}:${row.target_id}`) ?? null,
        }))}
        ownerColumn={leadsOwnerColumn}
        ownerId={user.id}
      />
    </div>
  );
}
