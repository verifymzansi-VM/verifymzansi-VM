import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/utils/format";
import { ScrollText } from "lucide-react";
import { isAdmin } from "@/lib/auth/roles";
import type { AuditLogEntry } from "@/lib/utils/admin-queries";

export const metadata = {
  title: "Audit Log — Admin",
};

export default async function AdminAuditLogPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdmin(user)) {
    redirect("/dashboard");
  }

  // Read from audit_logs table
  const { data: logs } = await supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Log"
        description="Track administrative actions and system events."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Audit Log" }]}
      />

      {!logs?.length ? (
        <div className="text-center py-10 text-muted-foreground">
          <ScrollText className="h-8 w-8 mx-auto mb-3" />
          <p>No audit entries recorded yet.</p>
          <p className="text-xs mt-1">Administrative actions will be logged here automatically.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {}
          {logs.map((entry: AuditLogEntry) => (
            <Card key={entry.id}>
              <CardContent className="py-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px]">
                        {entry.action}
                      </Badge>
                      {entry.target_type && (
                        <Badge variant="secondary" className="text-[10px]">
                          {entry.target_type}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {entry.actor_id} &middot; {formatRelativeTime(entry.created_at)}
                    </p>
                    {entry.metadata && (
                      <p className="text-xs text-muted-foreground truncate">
                        {typeof entry.metadata === "string"
                          ? entry.metadata
                          : JSON.stringify(entry.metadata)}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
