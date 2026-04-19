import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubscribeButton } from "./subscribe-button";

const toastMock = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

describe("SubscribeButton", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { assign: vi.fn() },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
    vi.unstubAllGlobals();
  });

  it("starts checkout with the provided stable plan id", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        checkoutUrl: "https://pay.ozow.com/checkout/pay-001",
        paymentId: "pay-001",
      }),
    } as Response);

    render(
      <SubscribeButton
        planId="550e8400-e29b-41d4-a716-446655440000"
        planName="Mzansi Market Growth"
        priceCents={25000}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /choose mzansi market growth/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/billing/create-checkout",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ planId: "550e8400-e29b-41d4-a716-446655440000" }),
        })
      );
    });

    expect(window.location.assign).toHaveBeenCalledWith("https://pay.ozow.com/checkout/pay-001");
  });

  it("passes an abort signal and ignores abort errors after unmount", async () => {
    let rejectFetch: ((reason?: unknown) => void) | undefined;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise<Response>((_, reject) => {
          rejectFetch = reject;
        })
    );

    const { unmount } = render(
      <SubscribeButton planId="plan-1" planName="Growth" priceCents={25000} />
    );

    fireEvent.click(screen.getByRole("button", { name: /choose growth/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/billing/create-checkout",
        expect.objectContaining({
          method: "POST",
          signal: expect.any(AbortSignal),
        })
      );
    });

    unmount();
    rejectFetch?.(new DOMException("aborted", "AbortError"));

    await waitFor(() => {
      expect(toastMock).not.toHaveBeenCalled();
    });
  });

  it("shows a sign-in prompt when checkout returns unauthorized", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        error: "Unauthorized",
      }),
    } as Response);

    render(
      <SubscribeButton
        planId="550e8400-e29b-41d4-a716-446655440000"
        planName="Mzansi Market Growth"
        priceCents={25000}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /choose mzansi market growth/i }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Sign in to continue to secure checkout.",
        })
      );
    });

    expect(screen.getByText("Sign in to continue to secure checkout.")).toBeInTheDocument();
  });
});
