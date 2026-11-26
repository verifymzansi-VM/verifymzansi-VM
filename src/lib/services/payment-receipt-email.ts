import { formatZAR } from "@/lib/utils/format";
import { COMPANY_LEGAL_NAME, COMPANY_REGISTRATION_NUMBER } from "@/lib/legal/company-identity";
import { brandedEmail, detailList, paragraph, sanitizeAppUrl } from "./email-template";

/** What the "Payment received" email shows, read from the database command
 * api.get_payment_receipt by the notification job
 * (src/lib/foundation/payment-receipt.ts). Nothing here identifies the member. */
export type PaymentReceipt = {
  kind: "plan" | "addon";
  invoiceNumber: string;
  /** When the payment was made (ISO time): when it settled, or for a bank
   * transfer the day its money cleared. */
  paidAt: string;
  /** The invoice line, for example "Individual slot — 30 days". */
  item: string;
  amountCents: number;
  /** The reference on the member's bank statement. */
  bankReference: string;
  /** The customer invoice (VM-YYYY-NNNNNN) the payment paid, if any. */
  customerInvoiceNumber?: string;
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
    ...(receipt.customerInvoiceNumber
      ? [["Invoice paid", receipt.customerInvoiceNumber] as [string, string]]
      : []),
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
    `${COMPANY_LEGAL_NAME} · Registration number ${COMPANY_REGISTRATION_NUMBER}`,
  ].join("\n\n");
  return { subject: PAYMENT_RECEIPT_SUBJECT, html, text };
}

/** What the invoice email shows (update 20261126053701), from
 * api.prepare_invoice_email, and its payment link. Nothing identifies the
 * member. */
export type InvoiceEmail = {
  invoiceNumber: string;
  /** The invoice line, for example "3 × Individual slot — 90 days". */
  item: string;
  totalCents: number;
  /** South African date, YYYY-MM-DD. */
  dueOn: string;
  /** The payment link's token (32 random bytes, base64url): the invoice
   * without signing in. */
  linkToken: string;
};

/** The invoice email: the invoice's number, line, total and due date, and its
 * payment link. */
export function buildInvoiceEmail(invoice: InvoiceEmail, appUrl?: string) {
  const origin = sanitizeAppUrl(appUrl ?? process.env.NEXT_PUBLIC_APP_URL);
  const subject = `Invoice ${invoice.invoiceNumber} from VerifyMzansi`;
  const intro = "VerifyMzansi sent you an invoice. You can view and pay it without signing in.";
  const rows: Array<[string, string]> = [
    ["Invoice number", invoice.invoiceNumber],
    ["Item", invoice.item],
    ["Amount due", formatZAR(invoice.totalCents)],
    ["Due date", paidOn(`${invoice.dueOn}T12:00:00+02:00`)],
  ];
  const note =
    "Anyone with this link can see and pay the invoice, so share it only with the person who pays it. Prefer a bank transfer? The bank details are on the invoice; use the invoice number as your reference.";
  const cta = {
    label: "View and pay invoice",
    href: `${origin}/pay-invoice?token=${encodeURIComponent(invoice.linkToken)}`,
  };
  const html = brandedEmail({
    tone: "info",
    eyebrow: "Invoice",
    title: "Your invoice",
    intro,
    bodyHtml: `${detailList(rows)}${paragraph(note)}`,
    cta,
    reason: "An invoice was issued to your VerifyMzansi account.",
  });
  const text = [
    subject,
    intro,
    rows.map(([label, value]) => `${label}: ${value}`).join("\n"),
    note,
    `${cta.label}: ${cta.href}`,
    `${COMPANY_LEGAL_NAME} · Registration number ${COMPANY_REGISTRATION_NUMBER}`,
  ].join("\n\n");
  return { subject, html, text };
}
