import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PaymentStatusPanel from "./payment-status-panel";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("PaymentStatusPanel", () => {
  it.each([
    ["needs_reconciliation", "Payment received — activation needs review"],
    ["refunded", "Payment refunded"],
    ["chargeback", "Payment reversed"],
    ["cancelled", "Checkout cancelled"],
  ] as const)("renders %s without claiming activation or a failed charge", (status, title) => {
    render(<PaymentStatusPanel initialStatus={status} paymentId="synthetic" />);
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.queryByText(/paid features are now active/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/payment did not complete/i)).not.toBeInTheDocument();
  });
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "complete", terminal: true }),
    }) as unknown as typeof fetch;
  });

  it("polls pending payments and updates the UI when they complete", async () => {
    render(<PaymentStatusPanel initialStatus="pending" paymentId="pay-1" />);

    expect(screen.getByText("Payment pending")).toBeInTheDocument();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/billing/payment-status?payment=pay-1", {
        cache: "no-store",
        signal: expect.any(AbortSignal),
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Payment confirmed")).toBeInTheDocument();
    });

    expect(screen.queryByText(/Refreshing payment status/i)).not.toBeInTheDocument();
  });

  it("does not poll when payment id is missing", async () => {
    render(<PaymentStatusPanel initialStatus="pending" />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.queryByText(/Refreshing payment status/i)).not.toBeInTheDocument();
  });

  it.each(["failed", "expired"] as const)(
    "checks a previously %s payment for late provider confirmation",
    async (initialStatus) => {
      render(<PaymentStatusPanel initialStatus={initialStatus} paymentId="pay-late" />);
      await waitFor(() => expect(screen.getByText("Payment confirmed")).toBeInTheDocument());
      expect(global.fetch).toHaveBeenCalledTimes(1);
    }
  );

  it("pauses long polling without declaring an unconfirmed payment expired", async () => {
    vi.useFakeTimers();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ status: "pending", terminal: false }),
    } as Response);
    render(<PaymentStatusPanel initialStatus="pending" paymentId="pay-pending" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 4000);
    });
    expect(screen.getByText("Payment pending")).toBeInTheDocument();
    expect(screen.queryByText("Checkout expired")).not.toBeInTheDocument();
    expect(screen.getByText(/Confirmation is taking longer/)).toBeInTheDocument();
  });

  it("stops polling when the status endpoint returns unauthorized", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    render(<PaymentStatusPanel initialStatus="pending" paymentId="pay-401" />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/billing/payment-status?payment=pay-401", {
        cache: "no-store",
        signal: expect.any(AbortSignal),
      });
    });

    await waitFor(() => {
      expect(screen.queryByText(/Refreshing payment status/i)).not.toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login?returnUrl=%2Fbilling%2Fsuccess%3Fpayment%3Dpay-401"
    );
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries an incomplete response instead of silently abandoning confirmation", async () => {
    vi.useFakeTimers();
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "complete", terminal: true }),
      } as Response);
    render(<PaymentStatusPanel initialStatus="pending" paymentId="pay-retry" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(screen.getByText("Payment confirmed")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not start overlapping requests when the tab becomes visible", async () => {
    let complete!: (response: Response) => void;
    vi.mocked(global.fetch).mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        })
    );
    render(<PaymentStatusPanel initialStatus="pending" paymentId="pay-slow" />);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      complete({
        ok: true,
        json: async () => ({ status: "complete", terminal: true }),
      } as Response);
    });
    expect(screen.getByText("Payment confirmed")).toBeInTheDocument();
  });

  const packageDetails = {
    slots: 10,
    startsAt: "2026-11-19T08:00:00.000Z",
    endsAt: "2026-12-19T08:00:00.000Z",
    newPostsLimit: 40,
    paidCents: 100000,
    individualSlots: true,
  };

  it("shows a paid Multi-listing package with its slots, dates in SA time and fair use", () => {
    render(
      <PaymentStatusPanel
        initialStatus="complete"
        paymentId="pay-package"
        packagePayment
        packageDetails={packageDetails}
      />
    );
    expect(screen.getByRole("heading", { name: "Your package is active" })).toBeInTheDocument();
    expect(screen.getByText(/Your 10 slots are ready to use now/)).toBeInTheDocument();
    expect(screen.getByText("19 Nov 2026, 10:00 (SA time)")).toBeInTheDocument();
    expect(screen.getByText("19 Dec 2026, 10:00 (SA time)")).toBeInTheDocument();
    expect(screen.getByText("Up to 40 every 30 days")).toBeInTheDocument();
    expect(screen.getByText("Nothing renews automatically.")).toBeInTheDocument();
    // No reminder is promised until package reminders exist (P4d).
    expect(screen.queryByText(/remind/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create a post" })).toHaveAttribute(
      "href",
      "/post/create"
    );
    expect(screen.getByRole("link", { name: "Go to My slots" })).toHaveAttribute(
      "href",
      "/dashboard/slots"
    );
    expect(
      screen.getByText(/Posts in your Individual slots can move into the package/)
    ).toBeInTheDocument();
    expect(screen.queryByText("Payment confirmed")).not.toBeInTheDocument();
  });

  it("leaves out the Individual slot note when the member holds none", () => {
    render(
      <PaymentStatusPanel
        initialStatus="complete"
        packagePayment
        packageDetails={{ ...packageDetails, individualSlots: false }}
      />
    );
    expect(
      screen.queryByText(/Posts in your Individual slots can move into the package/)
    ).not.toBeInTheDocument();
  });

  it("reads the package once a package payment is confirmed while the page is open", async () => {
    render(<PaymentStatusPanel initialStatus="pending" paymentId="pay-package" packagePayment />);
    await waitFor(() => expect(screen.getByText("Payment confirmed")).toBeInTheDocument());
    // The reload runs in an effect after that render, which can land a tick later.
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it("never reloads for a payment that is not a package", async () => {
    render(<PaymentStatusPanel initialStatus="pending" paymentId="pay-slot" />);
    await waitFor(() => expect(screen.getByText("Payment confirmed")).toBeInTheDocument());
    expect(refresh).not.toHaveBeenCalled();
  });
});
