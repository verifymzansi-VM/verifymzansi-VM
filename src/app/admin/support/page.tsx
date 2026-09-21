import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Inbox } from "lucide-react";
import { SupportInboxClient } from "./support-inbox-client";
import { verifyStaffActorRoleFromDb } from "@/lib/auth/admin-access";
import Link from "next/link";
import { uuidSchema } from "@/lib/validations/shared";
import { createLogger } from "@/lib/utils/logger";

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
  emailActivity?: { template: string; accepted: boolean; created_at: string }[];
}

export default async function AdminSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; submission?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await verifyStaffActorRoleFromDb(user))) {
    redirect("/dashboard");
  }

  const admin = createAdminClient();
  const params = await searchParams;
  const parsedPage = Number(params.page || 1);
  const page =
    Number.isSafeInteger(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 100_000) : 1;
  const pageSize = 50;
  const selected = uuidSchema.safeParse(params.submission);

  let query = admin
    .from("contact_submissions")
    .select("id, name, email, message, status, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (selected.success) query = query.eq("id", selected.data);
  const {
    data: submissions,
    error,
    count,
  } = await query.range(
    selected.success ? 0 : (page - 1) * pageSize,
    selected.success ? 0 : page * pageSize - 1
  );
  if (error) {
    createLogger("SupportInbox").error("Support inbox read failed", { error: error.message });
    return (
      <p role="alert">
        The support inbox could not be loaded. Refresh to try again. This does not mean there are no
        requests.
      </p>
    );
  }

  const rows: SupportSubmission[] = Array.isArray(submissions)
    ? (submissions as SupportSubmission[])
    : [];
  const newCount = rows.filter((r) => r.status === "new").length;
  let activityUnavailable = false;
  if (rows.length) {
    const { data: activity, error: activityError } = await admin
      .from("audit_logs")
      .select("target_id, action, created_at, metadata")
      .eq("target_type", "contact_submission")
      .in(
        "target_id",
        rows.map((r) => r.id)
      )
      .in("action", ["communication_email_sent", "communication_email_failed"])
      .order("created_at", { ascending: false })
      .limit(pageSize * 4);
    activityUnavailable = Boolean(activityError);
    for (const row of rows) {
      row.emailActivity = (activity || [])
        .filter((event) => event.target_id === row.id)
        .map((event) => ({
          template: String(event.metadata?.template || "email"),
          accepted: event.action === "communication_email_sent",
          created_at: event.created_at,
        }));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Support Inbox"
        description="Requests submitted through the website appear here. Direct domain email and email replies stay in your mail provider's inbox."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Support" }]}
      >
        <Badge variant={newCount > 0 ? "destructive" : "outline"} className="gap-1">
          {newCount} New on this page
        </Badge>
      </PageHeader>
      {activityUnavailable && (
        <p role="alert">
          Email activity could not be loaded. Request contents are still available below.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        {count ?? rows.length} requests{!selected.success && ` · Page ${page}`}
      </p>
      {selected.success && (
        <Link href="/admin/support" className="underline">
          View all support requests
        </Link>
      )}

      {rows.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground">
          <Inbox className="h-8 w-8 mx-auto mb-3" />
          <p>No support submissions yet.</p>
        </div>
      ) : (
        <SupportInboxClient submissions={rows} />
      )}
      {!selected.success && (
        <nav aria-label="Support inbox pages" className="flex gap-4">
          {page > 1 && (
            <Link href={`/admin/support?page=${page - 1}`} className="underline">
              Newer requests
            </Link>
          )}
          {page * pageSize < (count ?? 0) && (
            <Link href={`/admin/support?page=${page + 1}`} className="underline">
              Older requests
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
