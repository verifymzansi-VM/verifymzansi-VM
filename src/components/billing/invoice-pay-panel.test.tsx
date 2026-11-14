import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvoicePayPanel, type InvoicePayPanelProps } from "./invoice-pay-panel";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("@/lib/utils/csrf", () => ({ withCsrfHeaders: (headers: unknown) => headers }));

const props: InvoicePayPanelProps = {
  invoiceNumber: "VM-2026-000001",
  status: "issued",
  revision: 2,
  totalCents: 62100,
  buyer: { name: "Fixture Traders", address: "1 Example Road", registration_number: null },
  consentWording: "My slots start as soon as this invoice is paid.",
  checkoutOpen: false,
};
let fetch: ReturnType<typeof vi.fn>;
let assign: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, checkoutUrl: "https://pay.ozow.com/fixture" }),
  }));
  vi.stubGlobal("fetch", fetch);
  assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const sent = (call = 0) => JSON.parse(fetch.mock.calls[call][1].body);

describe("paying an invoice", () => {
  it("pays only once the cooling-off box is ticked, with the invoice total", async () => {
    render(<InvoicePayPanel {...props} />);
    const pay = screen.getByRole("button", { name: "Pay now" });
    expect(pay).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/My slots start as soon/));
    expect(pay).toBeEnabled();
    fireEvent.click(pay);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://pay.ozow.com/fixture"));
    expect(sent()).toEqual({
      action: "pay",
      invoiceNumber: "VM-2026-000001",
      expectedTotalCents: 62100,
      coolingOffConsent: true,
    });
  });

  it("asks for billing details first and saves them at the shown revision", async () => {
    render(<InvoicePayPanel {...props} buyer={null} revision={1} />);
    fireEvent.click(screen.getByLabelText(/My slots start as soon/));
    expect(screen.getByRole("button", { name: "Pay now" })).toBeDisabled();
    expect(screen.getByText("Save your billing details first.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Business or full name"), {
      target: { value: "Fixture Traders" },
    });
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "1 Example Road" } });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(sent()).toEqual({
      action: "billing",
      invoiceNumber: "VM-2026-000001",
      revision: 1,
      buyerName: "Fixture Traders",
      buyerAddress: "1 Example Road",
      buyerRegistrationNumber: null,
    });
  });

  it("shows the database's refusal and does not leave the page", async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: "This invoice is already paid." }),
    });
    render(<InvoicePayPanel {...props} />);
    fireEvent.click(screen.getByLabelText(/My slots start as soon/));
    fireEvent.click(screen.getByRole("button", { name: "Pay now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This invoice is already paid.");
    expect(assign).not.toHaveBeenCalled();
  });

  it("offers to continue an open payment, and only printing once paid or cancelled", () => {
    const { rerender } = render(<InvoicePayPanel {...props} checkoutOpen />);
    expect(screen.getByRole("button", { name: "Continue payment" })).toBeInTheDocument();
    rerender(<InvoicePayPanel {...props} status="paid" />);
    expect(screen.queryByRole("button", { name: /Pay now|Continue payment/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Print or save as PDF" })).toBeInTheDocument();
  });
});
