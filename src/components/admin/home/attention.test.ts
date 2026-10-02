import { describe, expect, it } from "vitest";
import type { StaffDashboard } from "@/lib/services/staff-dashboard";
import { attentionItems } from "./attention";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const base: StaffDashboard = {
  role: "admin",
  generated_at: "",
  queues: {
    reports: { open: 5, oldest_at: null, breached: 1, claimed: 2 },
    kyc: { pending: 3, oldest_at: null, high_risk: 0, claimed: 3 },
    content: { pending: 0, oldest_at: null, claimed: 0 },
    support: { new: 1, oldest_at: null },
  },
};

describe("attentionItems", () => {
  it("does not subtract breached reports from the unclaimed queue total", () => {
    const dashboard: StaffDashboard = {
      ...base,
      queues: { ...base.queues, reports: { open: 7, oldest_at: null, breached: 5, claimed: 1 } },
    };
    const reportItem = attentionItems(dashboard, "moderator").find(
      (item) => item.key === "reports"
    );
    expect(reportItem?.count).toBe(6);
  });
  it("lists urgent items first and leaves out work someone has claimed", () => {
    const items = attentionItems(base, "moderator");
    expect(items.map((i) => i.label)).toEqual([
      "1 report past its deadline",
      "3 open reports",
      "1 new support request",
    ]);
    expect(items[0].severity).toBe("urgent");
  });

  it("never links a role to a page it cannot open", () => {
    const dashboard: StaffDashboard = {
      ...base,
      // Not normally sent to moderators; if it ever is, the link must not appear.
      decisions: {
        escalated: 0,
        pending_approval: 0,
        expiring_24h: 0,
        oldest_at: null,
        failed_executions: 2,
        role_changes_pending: 1,
        appeals_open: 0,
        appeals_oldest_at: null,
      },
    };
    const hrefs = attentionItems(dashboard, "moderator").map((i) => i.href);
    expect(hrefs).not.toContain("/admin/operations");
    expect(hrefs).not.toContain("/admin/governance/roles");
    expect(attentionItems(dashboard, "admin").map((i) => i.href)).toContain("/admin/operations");
  });

  it("flags a stopped expiry job, and stays quiet while it runs", () => {
    const platform = (lastRun: string | null) => ({
      incidents_open: 0,
      incidents_critical: 0,
      jobs_dead: 0,
      jobs_waiting: 0,
      expiry_last_run: lastRun,
      staff: { moderator: 1, governance_controller: 1, admin: 2 },
    });
    const keys = (lastRun: string | null) =>
      attentionItems({ ...base, platform: platform(lastRun) }, "admin").map((i) => i.key);
    expect(keys(minutesAgo(4))).not.toContain("expiry-job");
    expect(keys(minutesAgo(30))).toContain("expiry-job");
    expect(keys(null)).toContain("expiry-job");
  });
});
