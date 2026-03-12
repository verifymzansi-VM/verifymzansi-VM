import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/utils/format";
import { ACCOUNT_PROFILE_TABLE } from "@/lib/account/compat";

interface LeadRow {
  id: string;
  target_type: string;
  message: string;
  status: string;
  buyer_name: string | null;
  buyer_email: string | null;
  created_at: string;
  listings: { title: string } | null;
}

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

  const { data: leads } = await supabase
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
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        description="Buyer enquiries for your listings."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Leads" }]}
      />

      {!leads?.length ? (
        <div className="text-center py-6 space-y-3">
          <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="text-lg font-medium">No leads yet</p>
          <p className="text-sm text-muted-foreground">
            Leads will appear here when buyers contact you about a listing.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {}
          {(leads as unknown as LeadRow[]).map((lead) => (
            <Card key={lead.id}>
              <CardContent className="py-4 space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium">Re: {lead.listings?.title || "Listing"}</p>
                    <Badge variant="outline" className="text-[10px] mt-1">
                      {lead.status}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatRelativeTime(lead.created_at)}
                  </span>
                </div>
                {lead.message && (
                  <p className="text-sm text-muted-foreground line-clamp-3">{lead.message}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
