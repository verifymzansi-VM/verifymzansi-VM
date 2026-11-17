import "server-only";
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
  const { readRestoredGovernancePage } = await import("@/lib/foundation/governance-server");
  const rows = await readRestoredGovernancePage(1, id);
  return { decision: rows[0] ?? null, timelineEvents: rows[0]?.timeline ?? [] };
}
