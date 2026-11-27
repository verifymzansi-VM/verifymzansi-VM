/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  session: vi.fn(),
  enforcement: vi.fn(),
  privacy: vi.fn(),
  appeals: vi.fn(),
  roles: vi.fn(),
  health: vi.fn(),
  claims: vi.fn(),
  activity: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./server-session", () => ({ readFoundationServerSession: m.session }));
vi.mock("./enforcement", () => ({ readFrontendEnforcement: m.enforcement }));
vi.mock("./privacy-requests", () => ({ readFrontendPrivacyQueue: m.privacy }));
vi.mock("./member-appeals", () => ({ readFrontendAppeals: m.appeals }));
vi.mock("./staff-role-review", () => ({ readRestoredStaffRoles: m.roles }));
vi.mock("./operations-health", () => ({ readStaffOperationsHealth: m.health }));
vi.mock("./staff-claims-server", () => ({ readMyFrontendStaffClaims: m.claims }));
vi.mock("./area-activity-server", () => ({ readNativeAreaActivity: m.activity }));

import { readStaffHomeSummary } from "./staff-home-summary";
import { FoundationStaffReadError } from "./staff-read";

const id = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({ user: { id }, api: {} });
  m.claims.mockResolvedValue({
    items: [
      {
        mine: true,
        item_type: "listing",
        id: "a",
        queue: "content",
        expires_at: "2026-11-27T10:00:00Z",
      },
      { mine: false, item_type: "report", id: "b", queue: "reports", expires_at: "x" },
    ],
  });
  m.activity.mockResolvedValue({ today: { approve: 2, reject: 1 } });
  m.enforcement.mockResolvedValue({ suspensions: 1, bans: 2, emergency: 1 });
  m.privacy.mockResolvedValue({
    total: 2,
    overdue: 1,
    due_soon: 1,
    items: [{ assigned_to: null }, { assigned_to: "x" }],
  });
  m.appeals.mockResolvedValue({
    total: 1,
    items: [{ created_at: "2026-11-20T08:00:00Z" }],
  });
  m.roles.mockResolvedValue({
    staff_total: 3,
    staff: [{ role: "moderator" }, { role: "governor" }, { role: "admin" }],
    pending: [{}, {}],
  });
  m.health.mockResolvedValue({
    incidents: { open: 2, items: [{ level: "critical" }, { level: "warning" }] },
    jobs: [
      { job: "post_lifecycle", last_run_at: "2026-11-27T09:00:00Z", late: false },
      { job: "retention", last_run_at: null, late: true },
    ],
    emails: { waiting: 4 },
    deletions: { evidence_overdue: 3, accounts_blocked: 1, files_stuck: 2, legal_holds: 5 },
  });
});

describe("readStaffHomeSummary", () => {
  it("gives a moderator only their own items", async () => {
    const out = await readStaffHomeSummary(id, { role: "moderator", counts: { decisions: 0 } });
    expect(out.shift).toEqual({
      claims: [
        {
          item_type: "listing",
          item_id: "a",
          queue: "content",
          expires_at: "2026-11-27T10:00:00Z",
        },
      ],
      escalations_open: 0,
      actions_today: 3,
    });
    expect(out).not.toHaveProperty("decisions");
    expect(m.enforcement).not.toHaveBeenCalled();
    expect(m.health).not.toHaveBeenCalled();
  });

  it("fills the governor cards from the foundation reads", async () => {
    const out = await readStaffHomeSummary(id, { role: "governor", counts: { decisions: 4 } });
    expect(out.decisions).toMatchObject({
      escalated: 4,
      appeals_open: 1,
      appeals_oldest_at: "2026-11-20T08:00:00Z",
      role_changes_pending: 2,
    });
    expect(out.restrictions).toEqual({ suspensions: 1, bans: 2, emergency: 1 });
    expect(out.dsar).toMatchObject({ open: 2, overdue: 1, due_7d: 1, unassigned: 1 });
    expect(out.platform).toBeUndefined();
  });

  it("fills the admin platform, team and retention cards", async () => {
    const out = await readStaffHomeSummary(id, { role: "admin", counts: { decisions: 0 } });
    expect(out.platform).toEqual({
      incidents_open: 2,
      incidents_critical: 1,
      jobs_dead: 1,
      jobs_waiting: 4,
      expiry_last_run: "2026-11-27T09:00:00Z",
      staff: { moderator: 1, governance_controller: 1, admin: 1 },
    });
    expect(out.retention).toEqual({ evidence_overdue: 3, deletions_stuck: 3, legal_holds: 5 });
  });

  it("leaves only the failed read unavailable, never zero", async () => {
    m.enforcement.mockRejectedValue(new Error("down"));
    m.health.mockRejectedValue(new Error("down"));
    const out = await readStaffHomeSummary(id, { role: "admin", counts: { decisions: 0 } });
    expect(out.restrictions).toBeNull();
    expect(out.platform).toBeNull();
    expect(out.retention).toBeNull();
    expect(out.dsar).toMatchObject({ open: 2 });
    expect(out.decisions?.role_changes_pending).toBe(2);
  });

  it("flags a read refused for an old authenticator code, so the page can ask to re-verify", async () => {
    m.privacy.mockRejectedValue(new FoundationStaffReadError(403, true));
    const out = await readStaffHomeSummary(id, { role: "governor", counts: { decisions: 0 } });
    expect(out.needs_reverify).toBe(true);
    m.privacy.mockRejectedValue(new Error("down"));
    const other = await readStaffHomeSummary(id, { role: "governor", counts: { decisions: 0 } });
    expect(other.needs_reverify).toBeUndefined();
  });

  it("leaves a failed appeals or staff-roles figure out of the decisions card", async () => {
    m.appeals.mockRejectedValue(new Error("down"));
    m.roles.mockRejectedValue(new Error("down"));
    const out = await readStaffHomeSummary(id, { role: "governor", counts: { decisions: 4 } });
    expect(out.decisions).not.toHaveProperty("appeals_open");
    expect(out.decisions).not.toHaveProperty("role_changes_pending");
  });

  it("refuses a changed account", async () => {
    m.session.mockResolvedValue({ user: { id: "other" }, api: {} });
    await expect(
      readStaffHomeSummary(id, { role: "admin", counts: { decisions: 0 } })
    ).rejects.toThrow();
  });
});
