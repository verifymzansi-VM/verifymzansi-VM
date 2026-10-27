import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FoundationStaffDecisionsPage } from "./staff-decisions-page";
import { FoundationStaffReadError } from "@/lib/foundation/staff-read";

const mocks = vi.hoisted(() => ({ access: vi.fn(), caller: vi.fn(), decisions: vi.fn() }));
vi.mock("@/lib/auth/require-staff", () => ({ requireStaff: mocks.access }));
vi.mock("@/lib/foundation/server-session", () => ({ readFoundationServerSession: mocks.caller }));
vi.mock("@/lib/foundation/staff-read", async (load) => ({
  ...(await load<Record<string, unknown>>()),
  readFoundationStaffDecisions: mocks.decisions,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(url);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
const callerId = "00000000-0000-4000-8000-000000000001";
const proposal = {
  id: "00000000-0000-4000-8000-000000000002",
  case_id: "00000000-0000-4000-8000-000000000003",
  subject_id: "00000000-0000-4000-8000-000000000004",
  case_kind: "kyc",
  action: "approve_override",
  status: "proposed",
  case_version: 1,
  current_case_version: 1,
  proposed_by: callerId,
  proposed_at: "2026-10-27T00:00:00.123456+00:00",
  approved_by: null,
  withdrawn_by: null,
};
describe("native governance records", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.access.mockResolvedValue({});
    mocks.caller.mockResolvedValue({ api: {}, user: { id: callerId } });
    mocks.decisions.mockResolvedValue({
      caller_id: callerId,
      items: [proposal],
      next_cursor: { before_at: proposal.proposed_at, before_id: proposal.id },
    });
  });
  it("binds reads to the verified caller and preserves exact filtered pagination", async () => {
    render(
      await FoundationStaffDecisionsPage({
        searchParams: Promise.resolve({ status: "proposed", case_id: proposal.case_id }),
      })
    );
    expect(mocks.access).toHaveBeenCalledWith("decision:approve");
    expect(mocks.decisions).toHaveBeenCalledWith({}, callerId, {
      limit: 50,
      status: "proposed",
      case_id: proposal.case_id,
    });
    const href = new URL(
      screen.getByRole("link", { name: "Older decisions" }).getAttribute("href")!,
      "http://localhost"
    );
    expect(href.searchParams.get("before_at")).toBe(proposal.proposed_at);
    expect(href.searchParams.get("case_id")).toBe(proposal.case_id);
    expect(screen.getByText(/You proposed this decision/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
  });
  it("stops before querying records when staff access is refused", async () => {
    mocks.access.mockRejectedValue(new Error("Denied"));
    await expect(FoundationStaffDecisionsPage({})).rejects.toThrow("Denied");
    expect(mocks.decisions).not.toHaveBeenCalled();
  });

  it("offers identity review only with both native case and evidence capabilities", async () => {
    for (const capabilities of [[], ["case:claim"], ["case:claim", "evidence:view"]]) {
      mocks.access.mockResolvedValue({ role: "admin", assignedCapabilities: capabilities });
      const view = render(await FoundationStaffDecisionsPage({}));
      expect(Boolean(screen.queryByRole("link", { name: "Open identity review desk" }))).toBe(
        capabilities.length === 2
      );
      view.unmount();
    }
  });
  it("requires fresh MFA and returns to the selected detail", async () => {
    mocks.decisions.mockRejectedValue(new FoundationStaffReadError(403, true));
    await expect(FoundationStaffDecisionsPage({ id: proposal.id })).rejects.toThrow(
      `next=${encodeURIComponent(`/admin/governance/escalations/${proposal.id}`)}`
    );
  });
  it("keeps outages distinct from empty decisions and missing details", async () => {
    mocks.decisions.mockRejectedValue(new FoundationStaffReadError(503));
    render(await FoundationStaffDecisionsPage({}));
    expect(screen.getByRole("alert")).toHaveTextContent("temporarily unavailable");
    expect(screen.queryByText("No decisions match these filters.")).not.toBeInTheDocument();
    mocks.decisions.mockResolvedValue({ items: [], next_cursor: null });
    await expect(FoundationStaffDecisionsPage({ id: proposal.id })).rejects.toThrow("NOT_FOUND");
  });
});
