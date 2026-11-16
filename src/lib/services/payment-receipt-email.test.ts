/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { buildPaymentReceiptEmail, type PaymentReceipt } from "./payment-receipt-email";

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
