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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AuditFilters = {
  action?: string;
  target?: string;
  actor?: string;
  type?: string;
  from?: string;
  to?: string;
  q?: string;
};

function clean(value: string | undefined, max = 80): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

export default async function AdminAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<AuditFilters>;
}) {
  const raw = await searchParams;
  const filters = {
    action: clean(raw.action)?.replace(/[^a-z0-9_]/gi, ""),
    target: clean(raw.target),
    actor: clean(raw.actor),
    type: clean(raw.type)?.replace(/[^a-z0-9_]/gi, ""),
    from: clean(raw.from, 10),
    to: clean(raw.to, 10),
    q: clean(raw.q, 100)?.replace(/[%_,()]/g, " "),
  };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdmin(user)) {
    redirect("/dashboard");
  }

  const admin = createAdminClient();

  // Read from audit_logs table
  let query = admin
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (filters.action) query = query.ilike("action", `${filters.action}%`);
  if (filters.target && UUID.test(filters.target)) query = query.eq("target_id", filters.target);
  if (filters.actor && UUID.test(filters.actor)) query = query.eq("actor_id", filters.actor);
  if (filters.type) query = query.eq("target_type", filters.type);
  if (filters.from && /^\d{4}-\d{2}-\d{2}$/.test(filters.from))
    query = query.gte("created_at", filters.from);
  if (filters.to && /^\d{4}-\d{2}-\d{2}$/.test(filters.to))
    query = query.lt("created_at", new Date(Date.parse(filters.to) + 86_400_000).toISOString());
  if (filters.q) query = query.ilike("reason", `%${filters.q}%`);
  const { data: logs } = await query;

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

      <form method="get" className="grid gap-2 rounded-xl border p-3 text-sm sm:grid-cols-4">
        <label>
          Action starts with
          <input
            name="action"
            defaultValue={filters.action}
            placeholder="e.g. organisation_"
            className="mt-1 block w-full rounded-md border bg-background p-2"
          />
        </label>
        <label>
          Target type
          <input
            name="type"
            defaultValue={filters.type}
            placeholder="e.g. commercial_contract"
            className="mt-1 block w-full rounded-md border bg-background p-2"
          />
        </label>
        <label>
          Target ID
          <input
            name="target"
            defaultValue={filters.target}
            className="mt-1 block w-full rounded-md border bg-background p-2"
          />
        </label>
        <label>
          Staff / actor ID
          <input
            name="actor"
            defaultValue={filters.actor}
            className="mt-1 block w-full rounded-md border bg-background p-2"
          />
        </label>
        <label>
          From
          <input
            type="date"
            name="from"
            defaultValue={filters.from}
            className="mt-1 block w-full rounded-md border bg-background p-2"
          />
        </label>
        <label>
          To
          <input
            type="date"
            name="to"
            defaultValue={filters.to}
            className="mt-1 block w-full rounded-md border bg-background p-2"
          />
        </label>
        <label className="sm:col-span-1">
          Reason contains
          <input
            name="q"
            defaultValue={filters.q}
            className="mt-1 block w-full rounded-md border bg-background p-2"
          />
        </label>
        <button type="submit" className="h-11 self-end rounded-md border px-4 font-medium">
          Search
        </button>
      </form>

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
                    {entry.reason ? <p className="text-xs">Reason: {entry.reason}</p> : null}
                    {entry.previous_value || entry.new_value ? (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground">
                          Previous / new value
                        </summary>
                        <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2">
                          {JSON.stringify(
                            { previous: entry.previous_value, new: entry.new_value },
                            null,
                            2
                          )}
                        </pre>
                      </details>
                    ) : null}
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
