import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/utils/format";
import { ScrollText } from "lucide-react";
import { isAdmin } from "@/lib/auth/roles";
import { ACCOUNT_PROFILE_TABLE } from "@/lib/account/compat";
import type { AuditLogEntry } from "@/lib/utils/admin-queries";

export const metadata = {
  title: "Audit Log — Admin",
  description: "Review admin actions, moderation decisions, and system events.",
};

export default async function AdminAuditLogPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdmin(user)) {
    redirect("/dashboard");
  }

  const admin = createAdminClient();

  // Read from audit_logs table
  const { data: logs } = await admin
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  // Resolve actor display names
  const actorIds = [...new Set((logs ?? []).map((e: AuditLogEntry) => e.actor_id).filter(Boolean))];
  const actorMap = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profiles } = await admin
      .from(ACCOUNT_PROFILE_TABLE)
      .select("user_id, display_name")
      .in("user_id", actorIds);
    for (const p of profiles ?? []) {
      if (p.display_name) actorMap.set(p.user_id, p.display_name);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Log"
        description="Track admin actions and system events."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Audit Log" }]}
      />

      {!logs?.length ? (
        <div className="text-center py-6 text-muted-foreground">
          <ScrollText className="h-8 w-8 mx-auto mb-3" />
          <p>No audit entries recorded yet.</p>
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
                      {actorMap.get(entry.actor_id) || entry.actor_id.slice(0, 8)} &middot;{" "}
                      {formatRelativeTime(entry.created_at)}
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
