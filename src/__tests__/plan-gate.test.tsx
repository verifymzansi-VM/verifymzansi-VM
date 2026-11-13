/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PLANS, getPlanCheckoutHref } from "@/lib/constants/pricing";

vi.mock("next/navigation", () => ({
  usePathname: () => "/post/create-listing",
}));

const { fetchPostingAllowance, onAuthStateChange } = vi.hoisted(() => ({
  fetchPostingAllowance: vi.fn(),
  onAuthStateChange: vi.fn(),
}));
vi.mock("@/lib/foundation/posting-allowance-client", () => ({ fetchPostingAllowance }));
vi.mock("@/lib/foundation/restored-browser-client", () => ({
  getRestoredFoundationBrowserClient: () => ({ auth: { onAuthStateChange } }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const { PlanGate, usePlanMaxPhotos } = await import("@/components/billing/plan-gate");

const OWNER = "11111111-1111-4111-8111-111111111111";

/** The allowance the server returns for the signed-in member (self-only). */
function allowance(overrides: Record<string, unknown> = {}) {
  return {
    account_id: OWNER,
    profile_exists: true,
    capacity: 0,
    used: 0,
    creation_remaining: 0,
    max_photos: 10,
    max_videos: 1,
    tier: "free",
    trial_ends_at: null,
    trial_used: true,
    trial_offer: {
      eligible: false,
      sevenDayAvailable: false,
      thirtyDayAvailable: false,
      remaining: null,
      launchEnabled: true,
      shortDays: 7,
      longDays: 30,
    },
    catalogue: {
      plans: [
        {
          area: "market",
          slot_capacity: 1,
          duration_days: 30,
          label: "30 Days",
          price_cents: 5000,
          max_photos: 10,
          max_videos: 1,
          activations_per_period: null,
          addon_capabilities: [],
        },
      ],
      addons: [],
    },
    ...overrides,
  };
}

function renderGate(props: Partial<React.ComponentProps<typeof PlanGate>> = {}) {
  return render(
    <PlanGate area="MZANSI_MARKET" {...props}>
      <div>Protected Content</div>
    </PlanGate>
  );
}

describe("PlanGate", () => {
  let authChanged: (event: string, session: { user: { id: string } } | null) => void;
  const unsubscribe = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchPostingAllowance.mockResolvedValue(allowance());
    onAuthStateChange.mockImplementation((callback) => {
      authChanged = callback;
      return { data: { subscription: { unsubscribe } } };
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("shows the form with the plan bar when a paid slot is free", async () => {
    fetchPostingAllowance.mockResolvedValue(
      allowance({ tier: "month", capacity: 1, used: 0, creation_remaining: 1 })
    );
    renderGate();

    expect(await screen.findByText("Protected Content")).toBeInTheDocument();
    expect(screen.getByText("30 Days plan")).toBeInTheDocument();
    expect(screen.getByText("0/1 listings used")).toBeInTheDocument();
    expect(fetchPostingAllowance).toHaveBeenCalledWith("MZANSI_MARKET");
  });

  it("asks a signed-out visitor to sign in", async () => {
    fetchPostingAllowance.mockRejectedValue(new Error("not_authenticated"));
    renderGate();

    expect(await screen.findByText("Sign in to post")).toBeInTheDocument();
    expect(screen.queryByText("Protected Content")).toBeNull();
  });

  it("sends signed-in members without a profile to phone setup with a returnUrl", async () => {
    fetchPostingAllowance.mockResolvedValue(allowance({ profile_exists: false }));
    renderGate();

    expect(await screen.findByRole("link", { name: /add phone number/i })).toHaveAttribute(
      "href",
      "/dashboard/complete-profile?returnUrl=%2Fpost%2Fcreate-listing"
    );
  });

  it("does not open the form when the allowance cannot be loaded", async () => {
    fetchPostingAllowance.mockRejectedValue(new Error("failed"));
    renderGate();

    expect(await screen.findByRole("button", { name: "Refresh page" })).toBeInTheDocument();
    expect(screen.queryByText("Protected Content")).toBeNull();
  });

  it("sends members to the checkout confirmation page when choosing a plan", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    renderGate();

    fireEvent.click(await screen.findByRole("button", { name: "Choose 30 Days" }));

    const plan = PLANS.find((p) => p.area === "MZANSI_MARKET" && p.durationDays === 30)!;
    expect(assign).toHaveBeenCalledWith(getPlanCheckoutHref(plan));
    expect(screen.queryByText("Protected Content")).toBeNull();
  });

  it("offers the introductory free week and opens the form when it is chosen", async () => {
    const selectedTrial = vi.fn();
    fetchPostingAllowance.mockResolvedValue(
      allowance({
        trial_used: false,
        trial_offer: {
          eligible: true,
          sevenDayAvailable: true,
          thirtyDayAvailable: false,
          remaining: null,
          launchEnabled: true,
          shortDays: 7,
          longDays: 30,
        },
      })
    );
    renderGate({ onTrialSelected: selectedTrial });

    fireEvent.click(await screen.findByRole("button", { name: "Choose 7 days free" }));

    expect(selectedTrial).toHaveBeenCalledWith(7);
    expect(screen.getByText("Protected Content")).toBeInTheDocument();
    expect(screen.getByText(/Introductory trial — 7 days/)).toBeInTheDocument();
  });

  it("reads the allowance again when the signed-in account changes", async () => {
    const { unmount } = renderGate();
    await screen.findByRole("button", { name: "Choose 30 Days" });
    expect(fetchPostingAllowance).toHaveBeenCalledTimes(1);

    await act(async () => {
      authChanged("SIGNED_IN", { user: { id: OWNER } });
    });
    await waitFor(() => expect(fetchPostingAllowance).toHaveBeenCalledTimes(2));

    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

describe("usePlanMaxPhotos", () => {
  function MaxPhotos() {
    return <p>{usePlanMaxPhotos("MZANSI_MARKET")} photos</p>;
  }

  beforeEach(() => vi.clearAllMocks());

  it("uses the photo limit from the allowance", async () => {
    fetchPostingAllowance.mockResolvedValue(allowance({ max_photos: 7 }));
    render(<MaxPhotos />);
    expect(await screen.findByText("7 photos")).toBeInTheDocument();
  });

  it("allows no photos when the allowance cannot be loaded", async () => {
    fetchPostingAllowance.mockRejectedValue(new Error("failed"));
    render(<MaxPhotos />);
    expect(await screen.findByText("0 photos")).toBeInTheDocument();
  });
});
