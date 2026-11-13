import { requireStaff } from "@/lib/auth/require-staff";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Inbox } from "lucide-react";
import { SupportInboxClient } from "./support-inbox-client";
import Link from "next/link";
import { uuidSchema } from "@/lib/validations/shared";
import { createLogger } from "@/lib/utils/logger";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { readFrontendSupportInbox } from "@/lib/foundation/support-inbox";

export const metadata = {
  title: "Support inbox — Admin",
  description: "Review and respond to contact form submissions.",
};

export interface SupportSubmission {
  id: string;
  name: string;
  email: string;
  message: string;
  status: "new" | "in_progress" | "resolved";
  created_at: string;
  revision?: number;
  emailActivity?: { template: string; accepted: boolean; created_at: string }[];
}

const pageSize = 50;
export default async function AdminSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; submission?: string }>;
}) {
  const { user } = await requireStaff();
  const params = await searchParams;
  const parsedPage = Number(params.page || 1);
  const page =
    Number.isSafeInteger(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 100_000) : 1;
  const selected = uuidSchema.safeParse(params.submission);
  let rows: SupportSubmission[], count: number, canRespond: boolean, activityUnavailable: boolean;
  try {
    const { api } = await readFoundationServerSession();
    const result = await readFrontendSupportInbox(api, user.id, page, selected.data);
    rows = result.items;
    count = result.total;
    canRespond = result.can_update;
    activityUnavailable = false;
  } catch {
    createLogger("SupportInbox").error("Support inbox read failed");
    return (
      <p role="alert">
        The support inbox could not be loaded. Refresh to try again. This does not mean there are no
        requests.
      </p>
    );
  }
  const newCount = rows.filter((r) => r.status === "new").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Support inbox"
        description="Requests submitted through the website appear here. Direct domain email and email replies stay in your mail provider's inbox."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Support" }]}
      >
        <Badge variant={newCount > 0 ? "destructive" : "outline"} className="gap-1">
          {newCount} New on this page
        </Badge>
      </PageHeader>
      {!canRespond && (
        <p className="text-sm text-muted-foreground">
          You can read support requests. Moderators and admins update their status.
        </p>
      )}
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
        <SupportInboxClient submissions={rows} canRespond={canRespond} />
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
