import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PaymentStatusPanel from "./payment-status-panel";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe("PaymentStatusPanel", () => {
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

    expect(screen.getByText("Payment Pending")).toBeInTheDocument();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/billing/payment-status?payment=pay-1", {
        cache: "no-store",
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Payment Confirmed")).toBeInTheDocument();
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
      });
    });

    await waitFor(() => {
      expect(screen.queryByText(/Refreshing payment status/i)).not.toBeInTheDocument();
    });
  });
});
