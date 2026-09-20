import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { usage, maybeSingle } = vi.hoisted(() => ({ usage: vi.fn(), maybeSingle: vi.fn() }));
vi.mock("@/lib/billing/free-posts", () => ({ getActiveFreePostUsage: usage }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
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
    expect(await screen.findByText(/3 extra free posts remaining/)).toHaveTextContent(
      "30 days from approval"
    );
    expect(screen.queryByText("Your Free Launch Offer")).not.toBeInTheDocument();
  });
  it("does not offer to downgrade an account grant to seven days", async () => {
    render(<IntroductoryTrialCard />);
    expect(await screen.findByText("Your 30-day free post")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Switch pending/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/capacity is checked/)).not.toBeInTheDocument();
  });
});
