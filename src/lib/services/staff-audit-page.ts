import "server-only";
import type { AuditLogEntry } from "@/lib/utils/admin-queries";
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
