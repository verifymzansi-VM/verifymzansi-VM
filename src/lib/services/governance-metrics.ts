import "server-only";
import { getDataBackend } from "@/lib/data-backend";
import { createAdminClient } from "@/lib/supabase/admin";
import { countsOrThrow } from "@/lib/admin/counts";
export async function readGovernanceMetrics() {
  if (getDataBackend() === "foundation") {
    const { readNativeGovernanceMetrics } =
      await import("@/lib/foundation/feature-controls-server");
    return readNativeGovernanceMetrics();
  }
  const admin = createAdminClient();
  const [total, approved, rejected, overridden] = countsOrThrow(
    await Promise.all([
      admin.from("decision_records").select("*", { count: "exact", head: true }),
      ...["approved", "rejected", "overridden"].map((status) =>
        admin
          .from("decision_records")
          .select("*", { count: "exact", head: true })
          .eq("status", status)
      ),
    ]),
    "Oversight figures"
  );
  return {
    total: total.count ?? 0,
    approved: approved.count ?? 0,
    rejected: rejected.count ?? 0,
    overridden: overridden.count ?? 0,
  };
}
