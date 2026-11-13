import { formatZAR } from "@/lib/utils/format";
import { brandedEmail, detailList, paragraph, sanitizeAppUrl } from "./email-template";

/** What the "Payment received" email shows, read from the database command
 * api.get_payment_receipt by the notification job
 * (src/lib/foundation/payment-receipt.ts). Nothing here identifies the member. */
export type PaymentReceipt = {
  kind: "plan" | "addon";
  invoiceNumber: string;
  /** When the payment settled (ISO time). */
  paidAt: string;
  /** The invoice line, for example "Individual slot — 30 days". */
  item: string;
  amountCents: number;
  /** The reference on the member's bank statement. */
  bankReference: string;
};

const PAYMENT_RECEIPT_SUBJECT = "Payment received";

function paidOn(iso: string): string {
  return new Date(iso).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Johannesburg",
  });
}

/** The receipt email. The same receipt always gives the same email, so a
 * retry under the same idempotency key repeats the same request. */
export function buildPaymentReceiptEmail(receipt: PaymentReceipt, appUrl?: string) {
  const origin = sanitizeAppUrl(appUrl ?? process.env.NEXT_PUBLIC_APP_URL);
  const intro = "Thank you. We received your payment. Keep this email as your receipt.";
  const rows: Array<[string, string]> = [
    ["Invoice number", receipt.invoiceNumber],
    ["Date paid", paidOn(receipt.paidAt)],
    ["Item", receipt.item],
    ["Amount paid", formatZAR(receipt.amountCents)],
    ["Bank reference", receipt.bankReference],
  ];
  const note =
    "Your bank statement shows the bank reference. Questions about this payment? Reply to this email and include the invoice number.";
  const cta =
    receipt.kind === "plan"
      ? { label: "See your slots", href: `${origin}/dashboard/slots` }
      : { label: "Go to your dashboard", href: `${origin}/dashboard` };
  const html = brandedEmail({
    tone: "success",
    eyebrow: "Receipt",
    title: PAYMENT_RECEIPT_SUBJECT,
    intro,
    bodyHtml: `${detailList(rows)}${paragraph(note)}`,
    cta: { ...cta, tone: "success" },
    reason: "A payment was made on your VerifyMzansi account.",
  });
  const text = [
    PAYMENT_RECEIPT_SUBJECT,
    intro,
    rows.map(([label, value]) => `${label}: ${value}`).join("\n"),
    note,
    `${cta.label}: ${cta.href}`,
  ].join("\n\n");
  return { subject: PAYMENT_RECEIPT_SUBJECT, html, text };
}
