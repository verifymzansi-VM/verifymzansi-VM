import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InvoiceDocument, formatInvoiceAmount, invoiceStatusLabel } from "./invoice-document";
import { FAKE_INVOICE_BANK, FIXTURE_INVOICE } from "@/test/customer-invoice";

describe("the customer invoice document", () => {
  it("is an invoice of a seller not registered for VAT, with no VAT line", () => {
    render(<InvoiceDocument invoice={FIXTURE_INVOICE} sellerAddress={null} bank={null} />);
    const doc = screen.getByRole("article");
    expect(within(doc).getByRole("heading", { name: "Invoice" })).toBeInTheDocument();
    expect(doc).toHaveTextContent("VM-2026-000001");
    expect(doc).toHaveTextContent("Verifymzansi (Pty) Ltd");
    expect(doc).toHaveTextContent("Registration number 2026/155305/07");
    expect(doc).toHaveTextContent("VerifyMzansi is not registered for VAT.");
    expect(doc.textContent).not.toMatch(/tax invoice|VAT \(|15%/i);
    expect(screen.getByTestId("invoice-total")).toHaveTextContent("R621.00");
    expect(doc).toHaveTextContent("Individual slot — 90 days");
    expect(doc).toHaveTextContent("Billing details not added yet.");
  });

  it("shows the seller's address and the bank transfer section only when set", () => {
    const { rerender } = render(
      <InvoiceDocument invoice={FIXTURE_INVOICE} sellerAddress={null} bank={null} />
    );
    expect(screen.queryByTestId("invoice-bank")).not.toBeInTheDocument();
    rerender(
      <InvoiceDocument
        invoice={FIXTURE_INVOICE}
        sellerAddress="1 Example Street, Town"
        bank={FAKE_INVOICE_BANK}
      />
    );
    const bank = screen.getByTestId("invoice-bank");
    expect(bank).toHaveTextContent("Example Bank");
    expect(bank).toHaveTextContent("VM-2026-000001");
    expect(screen.getByRole("article")).toHaveTextContent("1 Example Street, Town");
  });

  it("shows the buyer's billing details and, once paid, no payment instructions", () => {
    render(
      <InvoiceDocument
        invoice={{
          ...FIXTURE_INVOICE,
          status: "paid",
          paid_at: "2026-11-15T08:00:00.000+00:00",
          payment_status: "complete",
          buyer: {
            name: "Fixture Traders (Pty) Ltd",
            address: "1 Example Road\nEmpangeni",
            registration_number: "2020/123456/07",
          },
        }}
        sellerAddress={null}
        bank={FAKE_INVOICE_BANK}
      />
    );
    const doc = screen.getByRole("article");
    expect(doc).toHaveTextContent("Fixture Traders (Pty) Ltd");
    expect(doc).toHaveTextContent("Registration number 2020/123456/07");
    expect(doc).toHaveTextContent("Paid on 15 November 2026");
    expect(screen.queryByTestId("invoice-bank")).not.toBeInTheDocument();
    expect(screen.getByTestId("invoice-status")).toHaveTextContent("Paid");
  });

  it("labels its status from the invoice and its payment", () => {
    const today = new Date("2026-11-20T10:00:00Z");
    expect(invoiceStatusLabel(FIXTURE_INVOICE, today).label).toBe("Unpaid");
    expect(invoiceStatusLabel({ ...FIXTURE_INVOICE, due_on: "2026-11-19" }, today).label).toBe(
      "Overdue"
    );
    expect(invoiceStatusLabel({ ...FIXTURE_INVOICE, status: "void" }, today).label).toBe(
      "Cancelled"
    );
    expect(
      invoiceStatusLabel({ ...FIXTURE_INVOICE, status: "paid", payment_status: "refunded" }, today)
        .label
    ).toBe("Paid, then refunded");
    expect(formatInvoiceAmount(1035000)).toBe("R10 350.00");
  });
});
