import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VerificationProgress } from "./verification-progress";

describe("VerificationProgress", () => {
  it("labels every step with its status and marks the current step", () => {
    render(
      <VerificationProgress
        steps={[
          { type: "phone", status: "approved" },
          { type: "id_doc", status: "pending" },
        ]}
        currentStep="id_doc"
      />
    );

    expect(screen.getByLabelText("Phone: approved")).toBeInTheDocument();
    expect(screen.getByLabelText("ID Document: pending")).toHaveAttribute("aria-current", "step");
    expect(screen.getByLabelText("Selfie: not started")).toBeInTheDocument();
    expect(screen.getByLabelText("Location: not started")).toBeInTheDocument();
    // No review node unless the page asks for one.
    expect(screen.queryByLabelText(/^Review:/)).not.toBeInTheDocument();
    // Status is spelled out, not shown by colour alone.
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Now")).toBeInTheDocument();
  });

  it("shows submitted steps as in review and the final review outcome", () => {
    render(
      <VerificationProgress
        steps={[
          { type: "phone", status: "approved" },
          { type: "id_doc", status: "pending" },
          { type: "selfie", status: "needs_resubmission" },
          { type: "location", status: "pending" },
        ]}
        reviewState="attention"
      />
    );

    expect(screen.getByLabelText("Selfie: needs attention")).toBeInTheDocument();
    expect(screen.getByLabelText("Review: needs attention")).toBeInTheDocument();
    expect(screen.getAllByText("In review")).toHaveLength(2);
    expect(screen.getAllByText("Fix needed")).toHaveLength(2);
  });
});
