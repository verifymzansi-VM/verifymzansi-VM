import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACCOUNT_PROFILE_TABLE } from "@/lib/account/compat";
import type { AuditLogEntry } from "@/lib/utils/admin-queries";
import { getDataBackend } from "@/lib/data-backend";
import { createLogger } from "@/lib/utils/logger";
import { FoundationStaffCommandError } from "@/lib/foundation/staff-command";
import { staffVerifyHref } from "@/lib/auth/staff-mfa-links";
export type StaffAuditFilters = {
  action?: string;
  target?: string;
  actor?: string;
  type?: string;
  from?: string;
  to?: string;
  q?: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pageSize = 50;
type Result = {
  logs: AuditLogEntry[];
  error: { message: string } | null;
  total: number;
  hasOlder: boolean;
  actorMap: Map<string, string>;
};
export async function readStaffAuditPage(
  filters: StaffAuditFilters,
  page: number
): Promise<Result> {
  const filtered = Object.values(filters).some(Boolean);
  if (getDataBackend() === "foundation") {
    try {
      const { readFoundationServerSession } = await import("@/lib/foundation/server-session");
      const { readRestoredStaffAudit } = await import("@/lib/foundation/restored-staff-audit");
      const current = await readFoundationServerSession();
      const request: Record<string, unknown> = { page };
      for (const [key, value] of Object.entries(filters))
        if (value && (!(key === "actor" || key === "target") || uuid.test(value)))
          request[key] = value;
      const result = await readRestoredStaffAudit(current.api, current.user.id, request);
      return {
        total: result.total,
        hasOlder: page * pageSize < result.total,
        error: null,
        actorMap: new Map(
          result.items
            .filter((e) => e.actor_id && e.actor_name)
            .map((e) => [e.actor_id!, e.actor_name!])
        ),
        logs: result.items.map((e) => ({
          id: e.id,
          actor_id: e.actor_id,
          action: e.action,
          target_type: e.target_type,
          target_id: e.target_id,
          area: null,
          metadata: { target_id: e.target_id },
          created_at: e.occurred_at,
          reason: e.reason,
        })),
      };
    } catch (error) {
      if (error instanceof FoundationStaffCommandError && error.mfaRequired) {
        const { redirect } = await import("next/navigation");
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
        if (page > 1) query.set("page", String(page));
        redirect(
          staffVerifyHref(
            "/staff/two-step?confirm=1",
            `/admin/audit-log${query.size ? `?${query}` : ""}`
          )
        );
      }
      createLogger("AdminAuditLog").error("Native audit log read could not be confirmed");
      return {
        logs: [],
        error: { message: "Audit log unavailable" },
        total: 0,
        hasOlder: false,
        actorMap: new Map(),
      };
    }
  }
  const admin = createAdminClient();
  let query = admin
    .from("audit_logs")
    .select("*", { count: filtered ? "exact" : "estimated" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (filters.action) query = query.ilike("action", `${filters.action.replace(/_/g, "\\_")}%`);
  if (filters.target && uuid.test(filters.target)) query = query.eq("target_id", filters.target);
  if (filters.actor && uuid.test(filters.actor)) query = query.eq("actor_id", filters.actor);
  if (filters.type) query = query.eq("target_type", filters.type);
  if (filters.from && /^\d{4}-\d{2}-\d{2}$/.test(filters.from))
    query = query.gte("created_at", filters.from);
  if (filters.to && /^\d{4}-\d{2}-\d{2}$/.test(filters.to))
    query = query.lt("created_at", new Date(Date.parse(filters.to) + 86400000).toISOString());
  if (filters.q) query = query.ilike("reason", `%${filters.q}%`);
  const { data, error, count } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  if (error) createLogger("AdminAuditLog").error("Audit log read failed", { error: error.message });
  const logs: AuditLogEntry[] = data ?? [],
    total = count ?? logs.length;
  const actorIds = [
    ...new Set(logs.map((e) => e.actor_id).filter((id): id is string => Boolean(id))),
  ];
  const actorMap = new Map<string, string>();
  if (actorIds.length) {
    const { data: profiles } = await admin
      .from(ACCOUNT_PROFILE_TABLE)
      .select("user_id, display_name")
      .in("user_id", actorIds);
    for (const p of profiles ?? []) if (p.display_name) actorMap.set(p.user_id, p.display_name);
  }
  return {
    logs,
    error,
    total,
    actorMap,
    hasOlder: logs.length === pageSize && (!filtered || page * pageSize < total),
  };
}
