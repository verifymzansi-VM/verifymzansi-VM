/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  buildInvoiceEmail,
  buildPaymentReceiptEmail,
  type InvoiceEmail,
  type PaymentReceipt,
} from "./payment-receipt-email";

const receipt: PaymentReceipt = {
  kind: "plan",
  invoiceNumber: "INV-20261113-ABCDEF1234",
  // 00:30 on 13 November in South Africa, still 12 November in UTC.
  paidAt: "2026-11-12T22:30:00+00:00",
  item: "Individual slot — 30 days",
  amountCents: 6900,
  bankReference: "abcdef12345678",
};
const APP = "https://verifymzansi.example";

describe("buildPaymentReceiptEmail", () => {
  it("writes the plain-text receipt the owner approves", () => {
    const email = buildPaymentReceiptEmail(receipt, APP);
    expect(email.subject).toBe("Payment received");
    expect(email.text).toBe(
      [
        "Payment received",
        "Thank you. We received your payment. Keep this email as your receipt.",
        [
          "Invoice number: INV-20261113-ABCDEF1234",
          "Date paid: 13 November 2026",
          "Item: Individual slot — 30 days",
          "Amount paid: R 69.00",
          "Bank reference: abcdef12345678",
        ].join("\n"),
        "Your bank statement shows the bank reference. Questions about this payment? Reply to this email and include the invoice number.",
        `See your slots: ${APP}/dashboard/slots`,
        "VERIFYMZANSI (PTY) LTD · Registration number 2026/155305/07",
      ].join("\n\n")
    );
  });

  it("shows the same details in the HTML version", () => {
    const { html } = buildPaymentReceiptEmail(receipt, APP);
    for (const shown of [
      "INV-20261113-ABCDEF1234",
      "13 November 2026",
      "Individual slot — 30 days",
      "R 69.00",
      "abcdef12345678",
      `${APP}/dashboard/slots`,
      // Every email's footer names the company and its number (ECTA s43).
      "VERIFYMZANSI (PTY) LTD · Registration number 2026/155305/07",
    ])
      expect(html).toContain(shown);
    expect(html).not.toContain("/billing");
  });

  it("groups thousands and sends add-on buyers to the dashboard", () => {
    const email = buildPaymentReceiptEmail(
      { ...receipt, kind: "addon", item: "Urgent 7 days", amountCents: 123450 },
      APP
    );
    expect(email.text).toContain("Amount paid: R 1 234.50");
    expect(email.text).toContain(`Go to your dashboard: ${APP}/dashboard`);
    expect(email.text).not.toContain("slots");
  });

  it("escapes the item in the HTML version", () => {
    const { html, text } = buildPaymentReceiptEmail(
      { ...receipt, item: "Slot <script>x</script>" },
      APP
    );
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(text).toContain("Item: Slot <script>x</script>");
  });

  it("gives the same email for the same receipt, so a retry repeats the same request", () => {
    expect(buildPaymentReceiptEmail(receipt, APP)).toEqual(buildPaymentReceiptEmail(receipt, APP));
  });
});

describe("the receipt of an invoice payment", () => {
  it("names the invoice it paid, after the receipt's own number", () => {
    const email = buildPaymentReceiptEmail(
      { ...receipt, customerInvoiceNumber: "VM-2026-000012" },
      APP
    );
    expect(email.text).toContain(
      "Invoice number: INV-20261113-ABCDEF1234\nInvoice paid: VM-2026-000012\nDate paid:"
    );
    expect(email.html).toContain("VM-2026-000012");
    expect(buildPaymentReceiptEmail(receipt, APP).text).not.toContain("Invoice paid");
  });
});

describe("buildInvoiceEmail", () => {
  const invoice: InvoiceEmail = {
    invoiceNumber: "VM-2026-000012",
    item: "3 × Individual slot — 90 days",
    totalCents: 62100,
    dueOn: "2026-12-03",
    linkToken: "A".repeat(43),
  };

  it("writes the invoice's number, line, total, due date and payment link", () => {
    const email = buildInvoiceEmail(invoice, APP);
    expect(email.subject).toBe("Invoice VM-2026-000012 from VerifyMzansi");
    expect(email.text).toBe(
      [
        "Invoice VM-2026-000012 from VerifyMzansi",
        "VerifyMzansi sent you an invoice. You can view and pay it without signing in.",
        [
          "Invoice number: VM-2026-000012",
          "Item: 3 × Individual slot — 90 days",
          "Amount due: R 621.00",
          "Due date: 3 December 2026",
        ].join("\n"),
        "Anyone with this link can see and pay the invoice, so share it only with the person who pays it. Prefer a bank transfer? The bank details are on the invoice; use the invoice number as your reference.",
        `View and pay invoice: ${APP}/pay-invoice?token=${"A".repeat(43)}`,
        "VERIFYMZANSI (PTY) LTD · Registration number 2026/155305/07",
      ].join("\n\n")
    );
  });

  it("shows the same details and link in the HTML version", () => {
    const { html } = buildInvoiceEmail(invoice, APP);
    for (const shown of [
      "VM-2026-000012",
      "3 × Individual slot — 90 days",
      "R 621.00",
      "3 December 2026",
      `${APP}/pay-invoice?token=${"A".repeat(43)}`,
    ])
      expect(html).toContain(shown);
    expect(html).not.toContain("/billing");
  });
});
