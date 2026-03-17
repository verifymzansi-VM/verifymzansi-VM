/**
 * Regression tests for addon checkout button redirect behavior.
 *
 * Root cause of incident: all three addon buttons used Next.js
 * `router.push(checkoutUrl)` to redirect to external checkout URLs.
 * `router.push()` cannot navigate to external URLs — it treats them
 * as client-side routes, causing a 404.
 *
 * The fix: use `window.location.href = checkoutUrl` instead.
 *
 * These tests verify the correct redirect mechanism is used for each button.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ── Mock next/navigation ───────────────────────────────────────
const mockRouterPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

// ── Mock toast ─────────────────────────────────────────────────
const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ── Import components under test ───────────────────────────────
import { FeaturedButton } from "@/components/listings/featured-button";
import { BoostButton } from "@/components/listings/boost-button";
import { UrgentButton } from "@/components/listings/urgent-button";

// ── Helpers ────────────────────────────────────────────────────

const LISTING_ID = "00000000-0000-0000-0000-000000000001";
const EXTERNAL_CHECKOUT_URL = "https://pay.ozow.com/checkout?id=test-123&amount=25.00";

let originalLocationHref: string;

beforeEach(() => {
  vi.clearAllMocks();
  originalLocationHref = window.location.href;

  // Mock window.location.href setter
  Object.defineProperty(window, "location", {
    writable: true,
    value: { ...window.location, href: originalLocationHref },
  });

  // Reset fetch mock
  global.fetch = vi.fn();
});

afterEach(() => {
  // Restore window.location
  Object.defineProperty(window, "location", {
    writable: true,
    value: { href: originalLocationHref },
  });
});

function mockFetchSuccess() {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      checkoutUrl: EXTERNAL_CHECKOUT_URL,
      paymentId: "pay-001",
    }),
  });
}

function mockFetchError(errorMessage: string) {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: false,
    json: async () => ({ error: errorMessage }),
  });
}

function mockFetchNetworkFailure() {
  (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError("Failed to fetch"));
}

/** Returns a fetch that blocks until `resolve()` is called. */
function mockFetchDeferred() {
  let resolve!: (v: unknown) => void;
  const promise = new Promise((r) => {
    resolve = r;
  });
  (global.fetch as ReturnType<typeof vi.fn>).mockReturnValue(promise);
  return {
    resolve: () =>
      resolve({
        ok: true,
        json: async () => ({
          success: true,
          checkoutUrl: EXTERNAL_CHECKOUT_URL,
          paymentId: "pay-001",
        }),
      }),
  };
}

// ── Featured Button ────────────────────────────────────────────

describe("FeaturedButton redirect", () => {
  it("uses window.location.href (not router.push) on successful checkout", async () => {
    mockFetchSuccess();

    render(<FeaturedButton listingId={LISTING_ID} isFeatured={false} canFeature={true} />);

    const button = screen.getByTitle(/Feature this listing/i);
    fireEvent.click(button);

    await waitFor(() => {
      expect(window.location.href).toBe(EXTERNAL_CHECKOUT_URL);
    });

    // REGRESSION: must NOT use router.push for external URLs
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("shows toast on API error instead of redirecting", async () => {
    mockFetchError("Featured is only available on the Pro plan.");

    render(<FeaturedButton listingId={LISTING_ID} isFeatured={false} canFeature={true} />);

    const button = screen.getByTitle(/Feature this listing/i);
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
    });

    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("uses the override API path and custom item label when provided", async () => {
    mockFetchSuccess();

    render(
      <FeaturedButton
        listingId={LISTING_ID}
        isFeatured={false}
        canFeature={true}
        itemTypeLabel="promotion"
        featuredApiPath={`/api/promotions/${LISTING_ID}/featured`}
      />
    );

    const button = screen.getByTitle(/Feature this promotion/i);
    fireEvent.click(button);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(`/api/promotions/${LISTING_ID}/featured`, {
        method: "POST",
      });
    });
  });
});

// ── Boost Button ───────────────────────────────────────────────

describe("BoostButton redirect", () => {
  it("uses window.location.href (not router.push) on successful checkout", async () => {
    mockFetchSuccess();

    render(<BoostButton listingId={LISTING_ID} isBoosted={false} canBoost={true} />);

    const button = screen.getByTitle(/Boost this listing/i);
    fireEvent.click(button);

    await waitFor(() => {
      expect(window.location.href).toBe(EXTERNAL_CHECKOUT_URL);
    });

    // REGRESSION: must NOT use router.push for external URLs
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("shows toast on API error instead of redirecting", async () => {
    mockFetchError("Boost is not available on your plan.");

    render(<BoostButton listingId={LISTING_ID} isBoosted={false} canBoost={true} />);

    const button = screen.getByTitle(/Boost this listing/i);
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
    });

    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("uses the override API path and custom item label when provided", async () => {
    mockFetchSuccess();

    render(
      <BoostButton
        listingId={LISTING_ID}
        isBoosted={false}
        canBoost={true}
        itemTypeLabel="promotion"
        boostApiPath={`/api/promotions/${LISTING_ID}/boost`}
      />
    );

    const button = screen.getByTitle(/Boost this promotion/i);
    fireEvent.click(button);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(`/api/promotions/${LISTING_ID}/boost`, {
        method: "POST",
      });
    });
  });
});

// ── Urgent Button ──────────────────────────────────────────────

describe("UrgentButton redirect", () => {
  it("uses window.location.href (not router.push) on successful checkout", async () => {
    mockFetchSuccess();

    render(<UrgentButton listingId={LISTING_ID} isUrgent={false} canMarkUrgent={true} />);

    const button = screen.getByTitle(/Mark as urgent/i);
    fireEvent.click(button);

    await waitFor(() => {
      expect(window.location.href).toBe(EXTERNAL_CHECKOUT_URL);
    });

    // REGRESSION: must NOT use router.push for external URLs
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("shows toast on API error instead of redirecting", async () => {
    mockFetchError("Urgent is only available on the Pro plan.");

    render(<UrgentButton listingId={LISTING_ID} isUrgent={false} canMarkUrgent={true} />);

    const button = screen.getByTitle(/Mark as urgent/i);
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
    });

    expect(mockRouterPush).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────
// M3 · Network-failure catch branch (fetch throws TypeError)
// ────────────────────────────────────────────────────────────────

describe("FeaturedButton network failure", () => {
  it("shows generic toast when fetch throws (e.g. offline)", async () => {
    mockFetchNetworkFailure();

    render(<FeaturedButton listingId={LISTING_ID} isFeatured={false} canFeature={true} />);
    fireEvent.click(screen.getByTitle(/Feature this listing/i));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Something went wrong",
          description: "Please try again.",
          variant: "destructive",
        })
      );
    });
    expect(window.location.href).not.toBe(EXTERNAL_CHECKOUT_URL);
  });
});

describe("BoostButton network failure", () => {
  it("shows generic toast when fetch throws (e.g. offline)", async () => {
    mockFetchNetworkFailure();

    render(<BoostButton listingId={LISTING_ID} isBoosted={false} canBoost={true} />);
    fireEvent.click(screen.getByTitle(/Boost this listing/i));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Something went wrong",
          description: "Please try again.",
          variant: "destructive",
        })
      );
    });
    expect(window.location.href).not.toBe(EXTERNAL_CHECKOUT_URL);
  });
});

describe("UrgentButton network failure", () => {
  it("shows generic toast when fetch throws (e.g. offline)", async () => {
    mockFetchNetworkFailure();

    render(<UrgentButton listingId={LISTING_ID} isUrgent={false} canMarkUrgent={true} />);
    fireEvent.click(screen.getByTitle(/Mark as urgent/i));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Something went wrong",
          description: "Please try again.",
          variant: "destructive",
        })
      );
    });
    expect(window.location.href).not.toBe(EXTERNAL_CHECKOUT_URL);
  });
});

// ────────────────────────────────────────────────────────────────
// M3 · Disabled-state rendering (already active / no entitlement)
// ────────────────────────────────────────────────────────────────

describe("FeaturedButton disabled states", () => {
  it("renders disabled button with 'Already featured' when isFeatured=true", () => {
    render(<FeaturedButton listingId={LISTING_ID} isFeatured={true} canFeature={true} />);
    const btn = screen.getByTitle(/Already featured/i);
    expect(btn).toBeDisabled();
  });

  it("renders disabled 'Upgrade to Pro' button when canFeature=false", () => {
    render(<FeaturedButton listingId={LISTING_ID} isFeatured={false} canFeature={false} />);
    const btn = screen.getByTitle(/Upgrade to Pro/i);
    expect(btn).toBeDisabled();
  });

  it("renders item-specific upgrade text when itemTypeLabel is provided", () => {
    render(
      <FeaturedButton
        listingId={LISTING_ID}
        isFeatured={false}
        canFeature={false}
        itemTypeLabel="promotion"
      />
    );
    const btn = screen.getByTitle(/Upgrade to Pro to feature this promotion/i);
    expect(btn).toBeDisabled();
  });

  it("does NOT call fetch when clicking a disabled isFeatured button", async () => {
    render(<FeaturedButton listingId={LISTING_ID} isFeatured={true} canFeature={true} />);
    const btn = screen.getByTitle(/Already featured/i);
    fireEvent.click(btn);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("BoostButton disabled states", () => {
  it("renders disabled button with 'Already boosted' when isBoosted=true", () => {
    render(<BoostButton listingId={LISTING_ID} isBoosted={true} canBoost={true} />);
    const btn = screen.getByTitle(/Already boosted/i);
    expect(btn).toBeDisabled();
  });

  it("renders disabled 'Upgrade to Growth or Pro' button when canBoost=false", () => {
    render(<BoostButton listingId={LISTING_ID} isBoosted={false} canBoost={false} />);
    const btn = screen.getByTitle(/Upgrade to Growth or Pro/i);
    expect(btn).toBeDisabled();
  });

  it("renders item-specific upgrade text when itemTypeLabel is provided", () => {
    render(
      <BoostButton
        listingId={LISTING_ID}
        isBoosted={false}
        canBoost={false}
        itemTypeLabel="business"
      />
    );
    const btn = screen.getByTitle(/Upgrade to Growth or Pro to boost this business/i);
    expect(btn).toBeDisabled();
  });

  it("does NOT call fetch when clicking a disabled isBoosted button", async () => {
    render(<BoostButton listingId={LISTING_ID} isBoosted={true} canBoost={true} />);
    const btn = screen.getByTitle(/Already boosted/i);
    fireEvent.click(btn);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("UrgentButton disabled states", () => {
  it("renders disabled button with 'Already urgent' when isUrgent=true", () => {
    render(<UrgentButton listingId={LISTING_ID} isUrgent={true} canMarkUrgent={true} />);
    const btn = screen.getByTitle(/Already urgent/i);
    expect(btn).toBeDisabled();
  });

  it("renders disabled 'Upgrade to Pro' button when canMarkUrgent=false", () => {
    render(<UrgentButton listingId={LISTING_ID} isUrgent={false} canMarkUrgent={false} />);
    const btn = screen.getByTitle(/Upgrade to Pro/i);
    expect(btn).toBeDisabled();
  });

  it("does NOT call fetch when clicking a disabled isUrgent button", async () => {
    render(<UrgentButton listingId={LISTING_ID} isUrgent={true} canMarkUrgent={true} />);
    const btn = screen.getByTitle(/Already urgent/i);
    fireEvent.click(btn);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────
// M3 · Loading-state behavior (button disabled during fetch)
// ────────────────────────────────────────────────────────────────

describe("FeaturedButton loading state", () => {
  it("disables button while fetch is in flight, re-enables after", async () => {
    const deferred = mockFetchDeferred();

    render(<FeaturedButton listingId={LISTING_ID} isFeatured={false} canFeature={true} />);
    const btn = screen.getByTitle(/Feature this listing/i);
    expect(btn).not.toBeDisabled();

    fireEvent.click(btn);

    // While fetch is pending the button should be disabled
    await waitFor(() => expect(btn).toBeDisabled());

    // Resolve the fetch
    deferred.resolve();

    await waitFor(() => {
      expect(window.location.href).toBe(EXTERNAL_CHECKOUT_URL);
    });
  });
});

describe("BoostButton loading state", () => {
  it("disables button while fetch is in flight, re-enables after", async () => {
    const deferred = mockFetchDeferred();

    render(<BoostButton listingId={LISTING_ID} isBoosted={false} canBoost={true} />);
    const btn = screen.getByTitle(/Boost this listing/i);
    expect(btn).not.toBeDisabled();

    fireEvent.click(btn);

    await waitFor(() => expect(btn).toBeDisabled());

    deferred.resolve();

    await waitFor(() => {
      expect(window.location.href).toBe(EXTERNAL_CHECKOUT_URL);
    });
  });
});

describe("UrgentButton loading state", () => {
  it("disables button while fetch is in flight, re-enables after", async () => {
    const deferred = mockFetchDeferred();

    render(<UrgentButton listingId={LISTING_ID} isUrgent={false} canMarkUrgent={true} />);
    const btn = screen.getByTitle(/Mark as urgent/i);
    expect(btn).not.toBeDisabled();

    fireEvent.click(btn);

    await waitFor(() => expect(btn).toBeDisabled());

    deferred.resolve();

    await waitFor(() => {
      expect(window.location.href).toBe(EXTERNAL_CHECKOUT_URL);
    });
  });
});
