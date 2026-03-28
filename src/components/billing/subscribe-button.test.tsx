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
});
