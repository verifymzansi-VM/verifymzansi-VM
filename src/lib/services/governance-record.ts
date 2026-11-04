import "server-only";
import { getDataBackend } from "@/lib/data-backend";
import { createAdminClient } from "@/lib/supabase/admin";
import type { GovernanceScope } from "@/lib/foundation/governance";
type Decision = {
  id: string;
  case_id: string;
  case_type: string;
  action_category: string;
  status: string;
  recommender_id: string | null;
  approver_id: string | null;
  correlation_id: string | null;
  created_at: string;
  recommendation: string | null;
  approval_rationale: string | null;
  decided_at: string | null;
  payload_version: number | null;
  execution_status: string | null;
  foundation?: GovernanceScope;
  blockedReason?: string | null;
};
type Timeline = { id: string; event_type: string; detail: unknown; created_at: string };
export async function readGovernanceRecord(
  id: string
): Promise<{ decision: Decision | null; timelineEvents: Timeline[] }> {
  if (getDataBackend() === "foundation") {
    const { readRestoredGovernancePage } = await import("@/lib/foundation/governance-server");
    const rows = await readRestoredGovernancePage(1, id);
    return { decision: rows[0] ?? null, timelineEvents: rows[0]?.timeline ?? [] };
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("decision_records")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Decision could not be loaded");
  if (!data) return { decision: null, timelineEvents: [] };
  const timeline = await admin
    .from("decision_record_events")
    .select("*")
    .eq("decision_id", id)
    .order("created_at", { ascending: true });
  if (timeline.error) throw new Error("Decision timeline could not be loaded");
  return { decision: data, timelineEvents: timeline.data ?? [] };
}
