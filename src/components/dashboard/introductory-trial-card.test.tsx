import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { usage, maybeSingle } = vi.hoisted(() => ({ usage: vi.fn(), maybeSingle: vi.fn() }));
vi.mock("@/lib/billing/free-posts", () => ({ getActiveFreePostUsage: usage }));
vi.mock("@/lib/foundation/restored-browser-client", () => ({
  getRestoredFoundationBrowserClient: () => {
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      limit: () => query,
      maybeSingle,
    };
    return {
      auth: {
        getUser: async () => ({
          data: { user: { id: "member-1", app_metadata: { role: "member" } } },
        }),
      },
      from: () => query,
    };
  },
}));
import { IntroductoryTrialCard } from "./introductory-trial-card";

describe("account grants on the dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usage.mockResolvedValue({ available: false, offer: { eligible: false } });
    maybeSingle.mockResolvedValue({
      data: {
        id: "claim-1",
        admin_granted: true,
        duration_days: 30,
        activated_at: null,
        released_at: null,
        converted_at: null,
      },
    });
  });
  it("shows the 30-day account balance without promising a launch trial", async () => {
    usage.mockResolvedValue({
      available: true,
      offer: { eligible: true, adminFreePostsRemaining: 3 },
    });
    render(<IntroductoryTrialCard />);
    expect(await screen.findByText(/3 extra free posts left/)).toHaveTextContent(
      "30 days from approval"
    );
    expect(screen.queryByText(/your free launch offer/i)).not.toBeInTheDocument();
  });
  it("shows the new backend's running free week with its end date, without reading itself", () => {
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
    // The retired renewal route is hidden; the plan and posts links stay.
    expect(screen.queryByRole("button", { name: /Renew using my paid plan/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Choose a paid plan" })).toHaveAttribute(
      "href",
      "/billing"
    );
    expect(usage).not.toHaveBeenCalled();
    expect(maybeSingle).not.toHaveBeenCalled();
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
    expect(usage).not.toHaveBeenCalled();
  });
  it("does not offer to downgrade an account grant to seven days", async () => {
    render(<IntroductoryTrialCard />);
    expect(await screen.findByText("Your 30-day free post")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Switch pending/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/trial starts when approved/)).not.toBeInTheDocument();
  });
});
