import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * Tests for EvidenceDecisionControls component:
 * - Resubmit flow sends canonical "needs_resubmission" decision
 * - Non-approved decision requires reason code
 * - High-risk approval requires override reason
 * - Happy-path submit calls API and completion callback
 */

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/lib/constants/verification", () => ({
  REASON_CODES: ["blurry_image", "wrong_document", "expired_document"],
  OVERRIDE_REASON_CODES: ["verified_in_person", "manager_override"],
  DECISION_NOTE_TEMPLATES: ["Document verified manually"],
}));

import { EvidenceDecisionControls } from "@/components/admin/evidence-decision-controls";

// ── Mock data ────────────────────────────────────────────────

const baseStep = {
  id: "step-001",
  step_type: "id_doc",
  status: "pending",
  risk_level: "low",
  risk_score: 10,
  auto_status: null,
  reason_code: null,
  reviewed_by: null,
  reviewed_at: null,
  created_at: "2025-01-01T00:00:00Z",
  metadata: null,
};

const highRiskStep = {
  ...baseStep,
  risk_level: "high",
  risk_score: 85,
};

// ── Tests ────────────────────────────────────────────────────

describe("EvidenceDecisionControls", () => {
  const onComplete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("renders decision buttons", () => {
    render(<EvidenceDecisionControls step={baseStep} onComplete={onComplete} />);
    expect(screen.getByText("Approve")).toBeInTheDocument();
    expect(screen.getByText("Reject")).toBeInTheDocument();
    expect(screen.getByText("Resubmit")).toBeInTheDocument();
  });

  it("shows reason code selector when reject is selected", () => {
    render(<EvidenceDecisionControls step={baseStep} onComplete={onComplete} />);
    fireEvent.click(screen.getByText("Reject"));
    expect(screen.getByText("Reason Code")).toBeInTheDocument();
    expect(screen.getByTitle("Reason code")).toBeInTheDocument();
  });

  it("shows reason code selector when resubmit is selected", () => {
    render(<EvidenceDecisionControls step={baseStep} onComplete={onComplete} />);
    fireEvent.click(screen.getByText("Resubmit"));
    expect(screen.getByText("Reason Code")).toBeInTheDocument();
  });

  it("does not show reason code selector when approved is selected", () => {
    render(<EvidenceDecisionControls step={baseStep} onComplete={onComplete} />);
    fireEvent.click(screen.getByText("Approve"));
    expect(screen.queryByText("Reason Code")).not.toBeInTheDocument();
  });

  it("toasts error when submitting non-approved without reason code", async () => {
    render(<EvidenceDecisionControls step={baseStep} onComplete={onComplete} />);
    fireEvent.click(screen.getByText("Reject"));
    fireEvent.click(screen.getByText(/Confirm Rejection/));

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Please select a reason code" })
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("shows override reason field for high-risk approval", () => {
    render(<EvidenceDecisionControls step={highRiskStep} onComplete={onComplete} />);
    fireEvent.click(screen.getByText("Approve"));
    expect(screen.getByText("Override Reason (required)")).toBeInTheDocument();
  });

  it("toasts error when approving high-risk without override reason", async () => {
    render(<EvidenceDecisionControls step={highRiskStep} onComplete={onComplete} />);
    fireEvent.click(screen.getByText("Approve"));
    fireEvent.click(screen.getByText(/Confirm Approval/));

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Override reason required" })
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sends canonical 'needs_resubmission' when resubmit is clicked", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, decision: "needs_resubmission" }),
    });

    render(<EvidenceDecisionControls step={baseStep} onComplete={onComplete} />);

    // Click Resubmit
    fireEvent.click(screen.getByText("Resubmit"));

    // Select reason code
    const select = screen.getByTitle("Reason code");
    fireEvent.change(select, { target: { value: "blurry_image" } });

    // Submit
    fireEvent.click(screen.getByText(/Confirm Resubmission Request/));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/verification/decide",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"needs_resubmission"'),
        })
      );
    });

    // Verify the body does NOT contain raw "resubmit"
    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body as string);
    expect(body.decision).toBe("needs_resubmission");
    expect(body.stepId).toBe("step-001");
    expect(body.reasonCode).toBe("blurry_image");
  });

  it("calls onComplete after successful submission", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, decision: "approved" }),
    });

    render(<EvidenceDecisionControls step={baseStep} onComplete={onComplete} />);

    fireEvent.click(screen.getByText("Approve"));
    fireEvent.click(screen.getByText(/Confirm Approval/));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Step Approved",
        variant: "success",
      })
    );
  });

  it("shows error toast on API failure", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Internal server error" }),
    });

    render(<EvidenceDecisionControls step={baseStep} onComplete={onComplete} />);

    fireEvent.click(screen.getByText("Approve"));
    fireEvent.click(screen.getByText(/Confirm Approval/));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Decision failed",
          variant: "destructive",
        })
      );
    });

    expect(onComplete).not.toHaveBeenCalled();
  });
});
