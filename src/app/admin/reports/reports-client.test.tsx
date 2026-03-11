import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReportsClient } from "./reports-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function createReport(id: string, status: "open" | "resolved") {
  return {
    id,
    target_id: `target-${id}`,
    target_type: "listing",
    area: "MZANSI_MARKET",
    category: "scam",
    severity: "standard",
    description: `report-${id}`,
    screenshot_url: null,
    reporter_user_id: null,
    reporter_ip_hash: "hash",
    status,
    assigned_to: null,
    resolved_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("ReportsClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not offer enforcement actions for resolved reports", () => {
    render(<ReportsClient reports={[createReport("1", "open"), createReport("2", "resolved")]} />);

    expect(screen.getByText(/Open Reports \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Resolved \/ Dismissed \(1\)/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Take Action/i })).toHaveLength(1);
  });
});
