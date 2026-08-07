import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Inbox } from "lucide-react";
import { SupportInboxClient } from "./support-inbox-client";
import { isStaff } from "@/lib/auth/roles";

export const metadata = {
  title: "Support Inbox — Admin",
  description: "Review and respond to contact form submissions.",
};

export interface SupportSubmission {
  id: string;
  name: string;
  email: string;
  message: string;
  status: "new" | "in_progress" | "resolved";
  created_at: string;
}

export default async function AdminSupportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isStaff(user)) {
    redirect("/dashboard");
  }

  const admin = createAdminClient();

  const { data: submissions } = await admin
    .from("contact_submissions")
    .select("id, name, email, message, status, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const rows: SupportSubmission[] = Array.isArray(submissions)
    ? (submissions as SupportSubmission[])
    : [];
  const newCount = rows.filter((r) => r.status === "new").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Support Inbox"
        description="Review and respond to contact form submissions."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Support" }]}
      >
        <Badge variant={newCount > 0 ? "destructive" : "outline"} className="gap-1">
          {newCount} New
        </Badge>
      </PageHeader>

      {rows.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground">
          <Inbox className="h-8 w-8 mx-auto mb-3" />
          <p>No support submissions yet.</p>
        </div>
      ) : (
        <SupportInboxClient submissions={rows} />
      )}
    </div>
  );
}
