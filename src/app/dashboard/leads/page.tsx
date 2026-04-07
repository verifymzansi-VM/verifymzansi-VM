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
      target_type,
      message,
      status,
      buyer_name,
      buyer_email,
      created_at,
      listings:target_id (
        title
      )
    `
      )
      .order("created_at", { ascending: false })
      .limit(50),
    leadsOwnerColumn,
    user.id
  );

  const { data: leads } = await leadsQuery;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        description="Buyer enquiries for your listings."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Leads" }]}
      />

      <LeadsFeed
        initialLeads={(leads as unknown as LeadRow[]) ?? []}
        ownerColumn={leadsOwnerColumn}
        ownerId={user.id}
      />
    </div>
  );
}
