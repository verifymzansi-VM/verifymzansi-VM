import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DashboardOnboarding } from "./dashboard-onboarding";

function firstStep() {
  const steps = within(screen.getByRole("list", { name: "Getting started" })).getAllByRole(
    "listitem"
  );
  return steps[0];
}

describe("DashboardOnboarding", () => {
  afterEach(cleanup);

  it("adds no second post button: the dashboard banner's New post is the way to post", () => {
    render(
      <DashboardOnboarding
        isVerified={false}
        verificationStatus="incomplete"
        hasListings={false}
        hasBusinesses={false}
      />
    );
    expect(screen.queryByRole("link", { name: /Create your first post/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Post your first item/ })).toHaveAttribute(
      "href",
      "/post/create"
    );
  });

  it("keeps the verification step open while the ID is in review", () => {
    render(
      <DashboardOnboarding
        isVerified={false}
        verificationStatus="pending_review"
        hasListings={false}
        hasBusinesses={false}
      />
    );
    const step = firstStep();
    expect(step.textContent).toContain("Verification in review");
    expect(step.textContent).not.toContain("(done)");
    expect(step.textContent).toContain("1");
  });

  it("marks the verification step done once verification is accepted", () => {
    render(
      <DashboardOnboarding
        isVerified
        verificationStatus="verified"
        hasListings={false}
        hasBusinesses={false}
      />
    );
    const step = firstStep();
    expect(step.textContent).toContain("Verification approved");
    expect(step.textContent).toContain("(done)");
  });

  it("asks to complete verification when nothing was sent", () => {
    render(
      <DashboardOnboarding
        isVerified={false}
        verificationStatus="incomplete"
        hasListings
        hasBusinesses={false}
      />
    );
    expect(firstStep().textContent).toContain("Complete your verification");
    expect(firstStep().textContent).not.toContain("(done)");
    const second = within(screen.getByRole("list", { name: "Getting started" })).getAllByRole(
      "listitem"
    )[1];
    expect(second.textContent).toContain("(done)");
  });
});
