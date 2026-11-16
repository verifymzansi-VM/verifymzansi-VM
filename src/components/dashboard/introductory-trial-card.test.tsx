import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntroductoryTrialCard } from "./introductory-trial-card";

describe("introductory trial card", () => {
  it("shows the new backend's running free week with its end date", () => {
    render(
      <IntroductoryTrialCard
        foundationClaim={{
          id: "intro-trial",
          duration_days: 7,
          admin_granted: false,
          activated_at: "2026-11-10T08:00:00+00:00",
          expires_at: "2026-11-17T08:00:00+00:00",
          released_at: null,
          converted_at: null,
        }}
      />
    );
    expect(screen.getByText("Your 7-day introductory trial")).toBeInTheDocument();
    expect(screen.getByText(/^Visible until 17 November 2026\./)).toBeInTheDocument();
    // Renewing is hidden until it works; the plan and posts links stay.
    expect(screen.queryByRole("button", { name: /Renew using my paid plan/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Choose a paid plan" })).toHaveAttribute(
      "href",
      "/billing"
    );
  });
  it("shows a free week waiting for its post's approval, and nothing without one", () => {
    const { container, rerender } = render(
      <IntroductoryTrialCard
        foundationClaim={{
          id: "intro-trial",
          duration_days: 7,
          admin_granted: false,
          activated_at: null,
          expires_at: null,
          released_at: null,
          converted_at: null,
        }}
      />
    );
    expect(screen.getByText("In review. The trial starts when approved.")).toBeInTheDocument();
    rerender(<IntroductoryTrialCard foundationClaim={null} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("does not offer to switch a pending 30-day trial while trial changes are hidden", () => {
    render(
      <IntroductoryTrialCard
        foundationClaim={{
          id: "intro-trial",
          duration_days: 30,
          admin_granted: false,
          activated_at: null,
          expires_at: null,
          released_at: null,
          converted_at: null,
        }}
      />
    );
    expect(screen.getByText("Your 30-day introductory trial")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Switch pending/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Renew/ })).not.toBeInTheDocument();
  });
});
