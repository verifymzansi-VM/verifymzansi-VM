import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PayInvoicePage, { metadata } from "./page";
import { readInvoiceByLink } from "@/lib/foundation/customer-invoices";
import { readOnlinePaymentMaxCents } from "@/lib/foundation/payment-limits";
import { FIXTURE_INVOICE } from "@/test/customer-invoice";

vi.mock("@/components/layout/header", () => ({ Header: () => null }));
vi.mock("@/components/layout/footer", () => ({ Footer: () => null }));
vi.mock("@/lib/foundation/customer-invoices", () => ({ readInvoiceByLink: vi.fn() }));
vi.mock("@/lib/foundation/payment-limits", () => ({ readOnlinePaymentMaxCents: vi.fn() }));
vi.mock("@/lib/billing/invoice-settings", () => ({
  invoiceBankDetails: () => null,
  invoiceSellerAddress: () => null,
}));
vi.mock("@/components/billing/invoice-document", () => ({
  InvoiceDocument: (props: { invoice: { invoice_number: string } }) => (
    <h1>{`Invoice ${props.invoice.invoice_number}`}</h1>
  ),
}));
vi.mock("@/components/billing/invoice-pay-panel", () => ({
  InvoicePayPanel: (props: { linkToken?: string; invoiceNumber: string }) => (
    <p>{`panel ${props.invoiceNumber} ${props.linkToken ?? "no link"}`}</p>
  ),
}));

const token = "fixture-payment-link-token".padEnd(43, "x");
const params = (value: Record<string, string>) => ({ searchParams: Promise.resolve(value) });

describe("the invoice payment link page (items 34, 38)", () => {
  beforeEach(() => {
    vi.mocked(readInvoiceByLink).mockReset();
    vi.mocked(readOnlinePaymentMaxCents).mockResolvedValue(150_000);
  });

  it("is never indexed and never passes its address (with the token) to other sites", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe("no-referrer");
  });

  it("shows the invoice and the pay panel, which posts the link's token", async () => {
    vi.mocked(readInvoiceByLink).mockResolvedValue(FIXTURE_INVOICE);
    render(await PayInvoicePage(params({ token })));
    expect(readInvoiceByLink).toHaveBeenCalledWith(token);
    expect(screen.getByRole("heading", { name: "Invoice VM-2026-000001" })).toBeInTheDocument();
    expect(screen.getByText(`panel VM-2026-000001 ${token}`)).toBeInTheDocument();
  });

  it("says a link that does not work, without naming why", async () => {
    vi.mocked(readInvoiceByLink).mockResolvedValue(null);
    render(await PayInvoicePage(params({ token })));
    expect(
      screen.getByRole("heading", { name: "This payment link does not work" })
    ).toBeInTheDocument();
    expect(screen.queryByText(/panel/)).toBeNull();
  });

  it("thanks a payer back from Ozow, or says nothing was paid after a cancel", async () => {
    render(await PayInvoicePage(params({ ozow: "back" })));
    expect(screen.getByRole("heading", { name: "Thank you" })).toBeInTheDocument();
    render(await PayInvoicePage(params({ ozow: "cancelled" })));
    expect(screen.getByRole("heading", { name: "Payment not completed" })).toBeInTheDocument();
    expect(readInvoiceByLink).not.toHaveBeenCalled();
  });
});
