import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { LeadsFeed, type LeadRow } from "@/components/dashboard/leads-feed";
import { restoredOwnerEnquiries } from "@/lib/foundation/restored-inbox-server";

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
  const nativeLeads = await restoredOwnerEnquiries(user.id);
  const rows = nativeLeads as unknown as LeadRow[];
  const titles = new Map<string, { title: string }>();
  for (const row of nativeLeads) {
    if (row.listings) titles.set(`${row.target_type}:${row.target_id}`, row.listings);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        description="Reply fast to win the sale."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Leads" }]}
      />

      <LeadsFeed
        initialLeads={rows.map((row) => ({
          ...row,
          listings: titles.get(`${row.target_type}:${row.target_id}`) ?? null,
        }))}
        ownerColumn="owner_id"
        ownerId={user.id}
      />
    </div>
  );
}
