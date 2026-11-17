import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { z } from "zod";
import { adminVerificationDecideSchema } from "@/lib/validations/admin";
import { nativeIdentityScopeSchema } from "@/lib/admin/native-identity-review";
import {
  ID_ARTIFACT,
  REVIEW_SCOPE,
  SELFIE_ARTIFACT,
  STEP_UPDATED_AT,
  SUBJECT_LABEL,
  identityStep,
  staffJson,
} from "@/test/foundation-identity-review";

/**
 * Tests for EvidenceDecisionControls (the evidence desk) on the foundation
 * backend, with steps shaped as the foundation metadata route serves them:
 * - Resubmit flow sends canonical "needs_resubmission" decision
 * - Non-approved decision requires reason code
 * - High-risk approval requires override reason
 * - Approval is an explicit identity confirmation bound to the claimed review
 * - Happy-path submit calls API and completion callback
 */

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

import { EvidenceDecisionControls } from "@/components/admin/evidence-decision-controls";

/** The input the foundation decide route accepts (restored-identity-decision-route.ts). */
const restoredDecisionInput = adminVerificationDecideSchema
  .safeExtend({ foundation: nativeIdentityScopeSchema, stepMatches: z.boolean().optional() })
  .strict();

const idStep = identityStep("id_doc");
const selfieStep = identityStep("selfie");
const highRiskStep = identityStep("id_doc", 85);

const fetchMock = () => global.fetch as ReturnType<typeof vi.fn>;
function sentBody() {
  const [url, init] = fetchMock().mock.calls[0];
  expect(url).toBe("/api/admin/verification/decide");
  expect(init.method).toBe("POST");
  return JSON.parse(init.body as string);
}

describe("EvidenceDecisionControls", () => {
  const onComplete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("renders decision buttons", () => {
    render(<EvidenceDecisionControls step={idStep} onComplete={onComplete} />);
    expect(screen.getByText("Approve")).toBeInTheDocument();
    expect(screen.getByText("Reject")).toBeInTheDocument();
    expect(screen.getByText("Resubmit")).toBeInTheDocument();
  });

  it("shows reason code selector when reject is selected", () => {
    render(<EvidenceDecisionControls step={idStep} onComplete={onComplete} />);
    fireEvent.click(screen.getByText("Reject"));
    expect(screen.getByText("Reason code")).toBeInTheDocument();
    expect(screen.getByTitle("Reason code")).toBeInTheDocument();
  });

  it("shows reason code selector when resubmit is selected", () => {
    render(<EvidenceDecisionControls step={idStep} onComplete={onComplete} />);
    fireEvent.click(screen.getByText("Resubmit"));
    expect(screen.getByText("Reason code")).toBeInTheDocument();
  });

  it("does not show reason code selector when approved is selected", () => {
    render(<EvidenceDecisionControls step={idStep} onComplete={onComplete} />);
    fireEvent.click(screen.getByText("Approve"));
    expect(screen.queryByText("Reason code")).not.toBeInTheDocument();
  });

  it("toasts error when submitting non-approved without reason code", async () => {
    render(<EvidenceDecisionControls step={idStep} onComplete={onComplete} />);
    fireEvent.click(screen.getByText("Reject"));
    fireEvent.click(screen.getByText(/Confirm Rejection/));

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Please select a reason code" })
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([
    {
      kind: "an ID",
      step: idStep,
      buttonName: "Confirm ID number and name match",
      confirmation: "the ID number and legal name match the submitted details",
    },
    {
      kind: "a selfie",
      step: selfieStep,
      buttonName: "Confirm Selfie matches ID portrait",
      confirmation: "the selfie matches the ID portrait",
    },
  ])(
    "asks the reviewer to confirm the identity match before approving $kind",
    ({ step, buttonName, confirmation }) => {
      render(<EvidenceDecisionControls step={step} onComplete={onComplete} />);
      fireEvent.click(screen.getByText("Approve"));
      const confirm = screen.getByRole("button", { name: buttonName });
      expect(confirm.title).toContain(`Confirm that ${confirmation}: ${SUBJECT_LABEL}`);
      expect(confirm.title).toContain("high-risk submissions need an independent second reviewer");
      expect(screen.queryByText(/Confirm Approval/)).not.toBeInTheDocument();
    }
  );

  it("shows override reason field for high-risk approval", () => {
    render(<EvidenceDecisionControls step={highRiskStep} onComplete={onComplete} />);
    fireEvent.click(screen.getByText("Approve"));
    expect(screen.getByText("Override Reason (required)")).toBeInTheDocument();
    expect(screen.getByText(/This step has/)).toHaveTextContent("high risk (score: 85)");
  });

  it("toasts error when approving high-risk without override reason", async () => {
    render(<EvidenceDecisionControls step={highRiskStep} onComplete={onComplete} />);
    fireEvent.click(screen.getByText("Approve"));
    fireEvent.click(screen.getByText(/Confirm ID number and name match/));

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Override reason required" })
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sends a high-risk approval with its override reason", async () => {
    fetchMock().mockResolvedValue(
      staffJson({ success: true, status: "awaiting_second_reviewer", overrideProposed: true })
    );
    render(<EvidenceDecisionControls step={highRiskStep} onComplete={onComplete} />);
    fireEvent.click(screen.getByText("Approve"));
    fireEvent.change(screen.getByTitle("Override reason code"), {
      target: { value: "verified_in_person" },
    });
    fireEvent.click(screen.getByText(/Confirm ID number and name match/));

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    const body = sentBody();
    expect(body).toEqual({
      stepId: ID_ARTIFACT,
      expectedUpdatedAt: STEP_UPDATED_AT,
      decision: "approved",
      foundation: REVIEW_SCOPE,
      stepMatches: true,
      overrideReasonCode: "verified_in_person",
    });
    expect(restoredDecisionInput.safeParse(body).success).toBe(true);
  });

  it("sends canonical 'needs_resubmission' when resubmit is clicked", async () => {
    fetchMock().mockResolvedValue(
      staffJson({ success: true, status: "needs_resubmission", version: 8 })
    );

    render(<EvidenceDecisionControls step={selfieStep} onComplete={onComplete} />);

    // Click Resubmit
    fireEvent.click(screen.getByText("Resubmit"));

    // Select reason code
    const select = screen.getByTitle("Reason code");
    fireEvent.change(select, { target: { value: "blurry_image" } });

    // Fill in required reason note
    const textarea = screen.getByPlaceholderText("Explain the issue to the user…");
    fireEvent.change(textarea, { target: { value: "Image is too blurry to verify" } });

    // Submit
    fireEvent.click(screen.getByText(/Confirm Resubmission Request/));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    // The canonical decision, bound to the claimed review, with no identity match claim.
    const body = sentBody();
    expect(body).toEqual({
      stepId: SELFIE_ARTIFACT,
      expectedUpdatedAt: STEP_UPDATED_AT,
      decision: "needs_resubmission",
      foundation: REVIEW_SCOPE,
      reasonCode: "blurry_image",
      reasonNote: "Image is too blurry to verify",
    });
    expect(restoredDecisionInput.safeParse(body).success).toBe(true);
  });

  it("calls onComplete after successful submission", async () => {
    fetchMock().mockResolvedValue(staffJson({ success: true, status: "step_approved" }));

    render(<EvidenceDecisionControls step={idStep} onComplete={onComplete} />);

    fireEvent.click(screen.getByText("Approve"));
    fireEvent.click(screen.getByText(/Confirm ID number and name match/));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Step Approved",
        variant: "success",
      })
    );
    const body = sentBody();
    expect(body).toEqual({
      stepId: ID_ARTIFACT,
      expectedUpdatedAt: STEP_UPDATED_AT,
      decision: "approved",
      foundation: REVIEW_SCOPE,
      stepMatches: true,
    });
    expect(restoredDecisionInput.safeParse(body).success).toBe(true);
  });

  it("shows error toast on API failure", async () => {
    fetchMock().mockResolvedValue(
      staffJson(
        {
          error: "Staff access or the claim changed. Reload the queue before continuing.",
          reason: "staff_command_refused",
        },
        { status: 403 }
      )
    );

    render(<EvidenceDecisionControls step={idStep} onComplete={onComplete} />);

    fireEvent.click(screen.getByText("Approve"));
    fireEvent.click(screen.getByText(/Confirm ID number and name match/));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Decision failed",
          description: "Staff access or the claim changed. Reload the queue before continuing.",
          variant: "destructive",
        })
      );
    });

    expect(onComplete).not.toHaveBeenCalled();
  });

  it("sends nothing for a step without a claimed review scope", async () => {
    const { foundation: _scope, ...unscoped } = idStep;
    render(<EvidenceDecisionControls step={unscoped} onComplete={onComplete} />);

    fireEvent.click(screen.getByText("Approve"));
    fireEvent.click(screen.getByText(/Confirm Approval/));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Decision failed", variant: "destructive" })
      );
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });
});
