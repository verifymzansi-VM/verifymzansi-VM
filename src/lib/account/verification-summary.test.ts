import { describe, expect, it } from "vitest";
import { summarizeVerification } from "./verification-summary";

describe("summarizeVerification", () => {
  it("promotes admin-reviewed approved steps to verified even when profile status is stale", () => {
    const summary = summarizeVerification("incomplete", [
      { step_type: "phone", status: "approved" },
      { step_type: "id_doc", status: "approved", reviewed_at: "2026-04-20T10:00:00.000Z" },
      { step_type: "selfie", status: "approved", reviewed_at: "2026-04-20T10:05:00.000Z" },
      { step_type: "location", status: "approved" },
    ]);

    expect(summary.accountVerificationStatus).toBe("verified");
    expect(summary.stepsRemaining).toBe(0);
    expect(summary.allStepsApproved).toBe(true);
  });

  it("keeps fully submitted auto-approved steps pending until admin reviews identity", () => {
    const summary = summarizeVerification("pending_review", [
      { step_type: "phone", status: "approved" },
      { step_type: "id_doc", status: "approved" },
      { step_type: "selfie", status: "approved" },
      { step_type: "location", status: "approved" },
    ]);

    expect(summary.accountVerificationStatus).toBe("pending_review");
    expect(summary.stepsRemaining).toBe(0);
    expect(summary.allStepsApproved).toBe(true);
  });

  it("reports pending review once every required step has been submitted", () => {
    const summary = summarizeVerification("incomplete", [
      { step_type: "phone", status: "approved" },
      { step_type: "id_doc", status: "pending" },
      { step_type: "selfie", status: "approved" },
      { step_type: "location", status: "pending" },
    ]);

    expect(summary.accountVerificationStatus).toBe("pending_review");
    expect(summary.stepsRemaining).toBe(0);
    expect(summary.allStepsSubmitted).toBe(true);
  });

  it("does not let stale pending review hide missing required steps", () => {
    const summary = summarizeVerification("pending_review", [
      { step_type: "phone", status: "approved" },
      { step_type: "id_doc", status: "pending" },
      { step_type: "selfie", status: "pending" },
    ]);

    expect(summary.accountVerificationStatus).toBe("incomplete");
    expect(summary.stepsRemaining).toBe(1);
    expect(summary.allStepsSubmitted).toBe(false);
  });

  it("counts only unresolved steps as remaining for incomplete verification", () => {
    const summary = summarizeVerification("incomplete", [
      { step_type: "phone", status: "approved" },
      { step_type: "id_doc", status: "approved" },
    ]);

    expect(summary.accountVerificationStatus).toBe("incomplete");
    expect(summary.stepsRemaining).toBe(2);
  });

  it("marks verification incomplete when a step needs resubmission (not rejected)", () => {
    const summary = summarizeVerification("incomplete", [
      { step_type: "phone", status: "approved" },
      { step_type: "id_doc", status: "needs_resubmission" },
      { step_type: "selfie", status: "approved" },
    ]);

    expect(summary.accountVerificationStatus).toBe("incomplete");
    expect(summary.stepsRemaining).toBe(2);
    expect(summary.rejectedStepCount).toBe(0);
    expect(summary.needsResubmissionCount).toBe(1);
  });

  it("marks verification rejected when a step is hard-rejected", () => {
    const summary = summarizeVerification("incomplete", [
      { step_type: "phone", status: "approved" },
      { step_type: "id_doc", status: "rejected" },
      { step_type: "selfie", status: "approved" },
    ]);

    expect(summary.accountVerificationStatus).toBe("rejected");
    expect(summary.stepsRemaining).toBe(2);
    expect(summary.rejectedStepCount).toBe(1);
    expect(summary.needsResubmissionCount).toBe(0);
  });

  it("does not let a stale verified profile hide a hard-rejected step", () => {
    const summary = summarizeVerification("verified", [
      { step_type: "phone", status: "approved" },
      { step_type: "id_doc", status: "rejected" },
      { step_type: "selfie", status: "approved" },
      { step_type: "location", status: "approved" },
    ]);

    expect(summary.accountVerificationStatus).toBe("rejected");
    expect(summary.rejectedStepCount).toBe(1);
  });

  it("does not let duplicate approved rows hide a later actionable step state", () => {
    const summary = summarizeVerification("verified", [
      { step_type: "phone", status: "approved" },
      { step_type: "id_doc", status: "needs_resubmission" },
      { step_type: "id_doc", status: "approved", reviewed_at: "2026-04-20T10:00:00.000Z" },
      { step_type: "selfie", status: "approved", reviewed_at: "2026-04-20T10:05:00.000Z" },
      { step_type: "location", status: "approved" },
    ]);

    expect(summary.accountVerificationStatus).toBe("incomplete");
    expect(summary.needsResubmissionCount).toBe(1);
    expect(summary.allStepsApproved).toBe(false);
  });

  it("does not let a stale verified profile hide a resubmission step", () => {
    const summary = summarizeVerification("verified", [
      { step_type: "phone", status: "approved" },
      { step_type: "id_doc", status: "needs_resubmission" },
      { step_type: "selfie", status: "approved" },
      { step_type: "location", status: "approved" },
    ]);

    expect(summary.accountVerificationStatus).toBe("incomplete");
    expect(summary.needsResubmissionCount).toBe(1);
  });

  it("returns needsResubmissionCount of 0 when no steps need resubmission", () => {
    const summary = summarizeVerification("incomplete", [
      { step_type: "phone", status: "approved" },
      { step_type: "id_doc", status: "approved" },
    ]);

    expect(summary.needsResubmissionCount).toBe(0);
  });
});
