import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { staffGuard } from "@/test/staff-guard";
import type { StaffDashboard } from "@/lib/services/staff-dashboard";

const { getStaffDashboard } = vi.hoisted(() => ({ getStaffDashboard: vi.fn() }));

vi.mock(
  "@/lib/auth/require-staff",
  async () => (await import("@/test/staff-guard")).staffGuardModule
);
vi.mock("@/lib/services/staff-dashboard", () => ({ getStaffDashboard }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title, description }: { title: string; description: string }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  ),
}));
vi.mock("@/components/admin/home/traffic-panel", () => ({
  TrafficPanel: () => <section>Website traffic</section>,
  TrafficPanelSkeleton: () => null,
}));

import AdminHomePage from "./page";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const queues: StaffDashboard["queues"] = {
  reports: { open: 12, oldest_at: hoursAgo(30), breached: 3, claimed: 2 },
  kyc: { pending: 5, oldest_at: hoursAgo(2), high_risk: 1, claimed: 0 },
  content: { pending: 7, oldest_at: hoursAgo(1), claimed: 1 },
  support: { new: 4, oldest_at: hoursAgo(3) },
};

const decisionSections = {
  decisions: {
    escalated: 2,
    pending_approval: 1,
    expiring_24h: 1,
    oldest_at: hoursAgo(40),
    failed_executions: 1,
    role_changes_pending: 1,
    appeals_open: 3,
    appeals_oldest_at: hoursAgo(20),
  },
  restrictions: { suspensions: 4, bans: 2, emergency: 1 },
  dsar: { open: 6, overdue: 2, due_7d: 1, unassigned: 3, next_due_at: hoursAgo(-48) },
  oversight: {
    window_days: 30,
    appeals_resolved: 10,
    appeals_overturned: 2,
    decisions_made: 40,
    escalations: 5,
  },
};

const shift = {
  claims: [
    {
      item_type: "report",
      item_id: "aaaaaaaa-0000-4000-8000-000000000001",
      queue: "reports" as const,
      expires_at: hoursAgo(-0.2),
      renewals: 1,
    },
  ],
  escalations_open: 1,
  actions_today: 9,
};

function card(label: string) {
  return screen.getByText(label).closest("div.rounded-xl") as HTMLElement;
}

/** A figure in one of the side lists (platform health, team, oversight). */
function row(label: string) {
  return screen.getByText(label).closest("li") as HTMLElement;
}

describe("Admin home", () => {
  beforeEach(() => {
    staffGuard.reset();
    vi.clearAllMocks();
  });

  it("gives moderators their shift and the queues, and no decision data", async () => {
    staffGuard.as("moderator", "mod-1");
    getStaffDashboard.mockResolvedValue({ role: "moderator", generated_at: "", queues, shift });

    render(await AdminHomePage());

    expect(getStaffDashboard).toHaveBeenCalledWith("mod-1");
    expect(screen.getByRole("heading", { level: 1, name: "My shift" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Items you are holding" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claim 10 reports" })).toBeInTheDocument();
    expect(screen.getByText(/9 actions today/)).toBeInTheDocument();
    expect(within(card("Open reports")).getByText("3 past their deadline")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for a decision")).not.toBeInTheDocument();
    expect(screen.queryByText("Platform health")).not.toBeInTheDocument();
    expect(screen.queryByText("Website traffic")).not.toBeInTheDocument();
  });

  it("gives governors decisions, deadlines and oversight with their totals", async () => {
    staffGuard.as("governance_controller", "gov-1");
    getStaffDashboard.mockResolvedValue({
      role: "governance_controller",
      generated_at: "",
      queues,
      ...decisionSections,
    });

    render(await AdminHomePage());

    expect(screen.getByRole("heading", { level: 1, name: "Decisions" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Items you are holding" })).not.toBeInTheDocument();
    expect(within(card("Escalations")).getByText("3")).toBeInTheDocument();
    expect(screen.getByText("1 expires within 24 hours")).toBeInTheDocument();
    expect(card("Data requests overdue").closest("a")).toHaveAttribute(
      "href",
      "/admin/dsar?view=overdue"
    );
    expect(screen.getByText("of 10 appeals decided (20%)")).toBeInTheDocument();
    expect(screen.getByText("1 emergency suspension needs review")).toBeInTheDocument();
    expect(screen.queryByText("Platform health")).not.toBeInTheDocument();
  });

  it("gives admins platform health, the team and traffic as well", async () => {
    staffGuard.as("admin", "admin-1");
    getStaffDashboard.mockResolvedValue({
      role: "admin",
      generated_at: "",
      queues,
      shift,
      ...decisionSections,
      platform: {
        incidents_open: 2,
        incidents_critical: 1,
        jobs_dead: 0,
        jobs_waiting: 5,
        expiry_last_run: hoursAgo(0.05),
        staff: { moderator: 8, governance_controller: 2, admin: 1 },
      },
      retention: { evidence_overdue: 0, deletions_stuck: 0, legal_holds: 1 },
    });

    render(await AdminHomePage());

    expect(screen.getByRole("heading", { level: 1, name: "Platform" })).toBeInTheDocument();
    expect(screen.getByText("Platform health")).toBeInTheDocument();
    expect(within(row("Reports past deadline")).getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Keep at least two admins for recovery")).toBeInTheDocument();
    expect(screen.getByText("Website traffic")).toBeInTheDocument();
  });

  it("shows Unavailable, never zero, for a section that could not be read", async () => {
    staffGuard.as("governance_controller");
    getStaffDashboard.mockResolvedValue({
      role: "governance_controller",
      generated_at: "",
      queues: { ...queues, reports: null },
      ...decisionSections,
      dsar: null,
    });

    render(await AdminHomePage());

    expect(within(card("Open reports")).getByText("Unavailable")).toBeInTheDocument();
    expect(within(card("Data requests overdue")).getByText("Unavailable")).toBeInTheDocument();
    expect(within(card("Identity checks")).getByText("5")).toBeInTheDocument();
  });

  it("lists what needs a person in the banner, urgent work first", async () => {
    staffGuard.as("governance_controller");
    getStaffDashboard.mockResolvedValue({
      role: "governance_controller",
      generated_at: "",
      queues,
      ...decisionSections,
    });

    render(await AdminHomePage());

    const needs = screen.getByRole("navigation", { name: "Needs you now" });
    const links = within(needs).getAllByRole("link");
    expect(links[0]).toHaveTextContent("3 reports past their deadline");
    expect(links[0]).toHaveAttribute("href", "/admin/reports");
    expect(screen.getByRole("status")).toHaveTextContent(/things need you · \d+ urgent/);
  });

  it("says all clear and folds empty decision lists into one row", async () => {
    staffGuard.as("governance_controller");
    getStaffDashboard.mockResolvedValue({
      role: "governance_controller",
      generated_at: "",
      queues: {
        reports: { open: 0, oldest_at: null, breached: 0, claimed: 0 },
        kyc: { pending: 0, oldest_at: null, high_risk: 0, claimed: 0 },
        content: { pending: 0, oldest_at: null, claimed: 0 },
        support: { new: 0, oldest_at: null },
      },
      decisions: {
        escalated: 0,
        pending_approval: 0,
        expiring_24h: 0,
        oldest_at: null,
        failed_executions: 0,
        role_changes_pending: 0,
        appeals_open: 0,
        appeals_oldest_at: null,
      },
      restrictions: { suspensions: 0, bans: 0, emergency: 0 },
      dsar: null,
      oversight: decisionSections.oversight,
    });

    render(await AdminHomePage());

    expect(screen.getByRole("status")).toHaveTextContent("All clear. Nothing needs you right now.");
    expect(screen.queryByRole("navigation", { name: "Needs you now" })).not.toBeInTheDocument();
    const clear = screen.getByRole("list", { name: "Lists with nothing waiting" });
    expect(within(clear).getByRole("link", { name: /Appeals/ })).toHaveAttribute(
      "href",
      "/admin/governance/appeals"
    );
    // A list that could not be read keeps its card, never hidden among the clear ones.
    expect(within(card("Data requests overdue")).getByText("Unavailable")).toBeInTheDocument();
  });

  it("says so when the home page cannot be loaded at all", async () => {
    getStaffDashboard.mockResolvedValue(null);

    render(await AdminHomePage());

    expect(screen.getByRole("alert")).toHaveTextContent("does not mean the queues are empty");
  });
});
