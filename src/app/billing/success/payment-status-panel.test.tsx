import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PaymentStatusPanel from "./payment-status-panel";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe("PaymentStatusPanel", () => {
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
});
