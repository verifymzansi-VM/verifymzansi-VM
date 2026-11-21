import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { staffGuard } from "@/test/staff-guard";
import { FoundationStaffCommandError } from "@/lib/foundation/staff-command";
import { SCHEDULED_JOBS, type OperationsHealth } from "@/lib/foundation/operations-health";
import OperationsHealthPage from "./page";

const { readStaffOperationsHealth, redirectMock, switches } = vi.hoisted(() => ({
  readStaffOperationsHealth: vi.fn(),
  redirectMock: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  switches: { SHOW_STAFF_OPERATIONS: true },
}));

vi.mock(
  "@/lib/auth/require-staff",
  async () => (await import("@/test/staff-guard")).staffGuardModule
);
vi.mock("@/lib/hidden-features", () => ({
  get SHOW_STAFF_OPERATIONS() {
    return switches.SHOW_STAFF_OPERATIONS;
  },
}));
vi.mock("@/lib/foundation/server-session", () => ({
  readFoundationServerSession: vi.fn(async () => ({ api: { rpc: vi.fn() } })),
}));
vi.mock("@/lib/foundation/operations-health", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readStaffOperationsHealth,
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title, description }: { title: string; description: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  ),
}));

const AT = "2026-11-20T08:00:00.000Z";

function healthy(): OperationsHealth {
  return {
    generated_at: AT,
    jobs: SCHEDULED_JOBS.map((job) => ({
      job,
      every: job === "refund_check" ? "day" : "minute",
      last_run_at: AT,
      late: false,
    })),
    emails: { waiting: 0, stuck: 0, items: [] },
    notices: { stuck: 0, undeliverable: 0, items: [] },
    payments: { problems: 0, not_activated: 0, items: [] },
    deletions: {
      accounts_blocked: 0,
      files_stuck: 0,
      files_queued: 0,
      evidence_overdue: 0,
      legal_holds: 0,
      items: [],
    },
    incidents: { open: 0, items: [] },
  };
}

/** The card whose title (an h3 in its header) is `title`. */
function card(title: string) {
  return screen.getByRole("heading", { level: 3, name: title }).parentElement!.parentElement!;
}

describe("OperationsHealthPage", () => {
  beforeEach(() => {
    staffGuard.reset();
    vi.clearAllMocks();
    switches.SHOW_STAFF_OPERATIONS = true;
    readStaffOperationsHealth.mockResolvedValue(healthy());
  });

  it("needs audit:view", async () => {
    render(await OperationsHealthPage());
    expect(staffGuard.requireStaff).toHaveBeenCalledWith("audit:view");
  });

  it("leads to the staff home while switched off, without reading anything", async () => {
    switches.SHOW_STAFF_OPERATIONS = false;
    await expect(OperationsHealthPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/admin");
    expect(readStaffOperationsHealth).not.toHaveBeenCalled();
  });

  it("shows every scheduled job, and the quiet states when nothing is stuck", async () => {
    render(await OperationsHealthPage());
    expect(screen.getByRole("heading", { level: 1, name: "Operations health" })).toBeVisible();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(SCHEDULED_JOBS.length);
    expect(rows[2]).toHaveTextContent("Sponsored places");
    expect(rows[5]).toHaveTextContent("Partner commissions");
    expect(rows[11]).toHaveTextContent("Data retention");
    expect(screen.getAllByText("On time")).toHaveLength(SCHEDULED_JOBS.length);
    expect(screen.queryByText("Late")).toBeNull();
    expect(screen.getByText("None. Emails are going out.")).toBeVisible();
    expect(screen.getByText("None. Notices are going out.")).toBeVisible();
    expect(screen.queryByText(/can never be sent/)).toBeNull();
    expect(screen.getByText("None in the past 7 days.")).toBeVisible();
    expect(screen.getByText("None. Closed accounts are being deleted on time.")).toBeVisible();
    expect(screen.getByText("No open incidents.")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows late jobs, stuck work, payment problems, blocked deletions and alarms", async () => {
    const health = healthy();
    health.jobs[2] = { job: "sponsorships", every: "minute", last_run_at: null, late: true };
    health.jobs[11] = { job: "retention", every: "5_minutes", last_run_at: AT, late: true };
    health.emails = {
      waiting: 5,
      stuck: 1,
      items: [
        { kind: "enquiry_received", attempts: 8, queued_at: AT, last_error: "delivery_failed" },
      ],
    };
    health.notices = {
      stuck: 1,
      undeliverable: 2,
      items: [{ kind: "submitted", attempts: 3, queued_at: AT }],
    };
    health.payments = {
      problems: 1,
      not_activated: 2,
      items: [
        {
          payment_ref: "abcdef12",
          reason: "amount_mismatch",
          source: "notice",
          first_seen_at: AT,
          last_seen_at: AT,
          occurrences: 3,
          alerted: true,
        },
      ],
    };
    health.deletions = {
      accounts_blocked: 1,
      files_stuck: 2,
      files_queued: 4,
      evidence_overdue: 1,
      legal_holds: 1,
      items: [{ reason: "refund_open", blocked_at: AT, erase_after: AT, closed_by: "member" }],
    };
    health.incidents = {
      open: 1,
      items: [{ metric: "sms_codes_day", level: "critical", period: "2026-11-20", raised_at: AT }],
    };
    readStaffOperationsHealth.mockResolvedValue(health);
    render(await OperationsHealthPage());

    expect(screen.getAllByText("Late")).toHaveLength(2);
    const sponsorships = screen.getByRole("row", { name: /Sponsored places/ });
    expect(within(sponsorships).getByText("Never")).toBeVisible();
    expect(within(sponsorships).getByText("Late")).toBeVisible();
    expect(screen.getByText(/5 emails are waiting to send\./)).toBeVisible();
    expect(screen.getByText("enquiry received")).toBeVisible();
    expect(screen.getByText("delivery failed")).toBeVisible();
    expect(screen.getByText("submitted notice")).toBeVisible();
    const undeliverable = screen.getByText(
      "2 notices from the last 30 days can never be sent: the request was minimised or the account's email address changed or is not confirmed."
    );
    expect(undeliverable).toBeVisible();
    expect(undeliverable).not.toHaveClass("text-destructive");
    expect(screen.getByText("2 paid payments were not activated.")).toBeVisible();
    expect(screen.getByText("amount mismatch")).toBeVisible();
    expect(screen.getByText(/Payment abcdef12 · notice · seen 3 times/)).toBeVisible();
    expect(screen.getByText("Staff alerted")).toBeVisible();
    expect(screen.getByRole("link", { name: "Payments & Refunds" })).toHaveAttribute(
      "href",
      "/admin/payments"
    );
    expect(screen.getByText("refund open")).toBeVisible();
    expect(screen.getByText(/Closed by member · held back since/)).toBeVisible();
    expect(within(card("Evidence retention")).getByText("4")).toBeVisible();
    expect(screen.getByText(/sms codes day \(2026-11-20\)/)).toBeVisible();
    expect(screen.getByText("critical")).toBeVisible();
  });

  it("sends staff to verify their authenticator again, then back here", async () => {
    readStaffOperationsHealth.mockRejectedValue(
      new FoundationStaffCommandError(403, "Verify again", true)
    );
    await expect(OperationsHealthPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/staff/two-step?next=%2Fadmin%2Foperations");
  });

  it("never claims all is well when the read fails", async () => {
    readStaffOperationsHealth.mockRejectedValue(new Error("down"));
    render(await OperationsHealthPage());
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Operations health could not be loaded. Refresh to try again. This does not mean everything is working."
    );
    expect(screen.queryByText("None. Emails are going out.")).toBeNull();
  });
});
