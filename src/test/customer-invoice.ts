import type { CustomerInvoice } from "@/lib/foundation/customer-invoices";

/**
 * A customer invoice as api.get_my_invoice answers it (update
 * 20261114041000), for the invoice adapter, route and screen tests. Synthetic:
 * no real customer, and no bank details (those come only from server-side
 * settings; tests use obviously fake ones).
 */
export const FIXTURE_INVOICE = {
  invoice_id: "11111111-1111-4111-8111-111111111111",
  invoice_number: "VM-2026-000001",
  status: "issued",
  issued_at: "2026-11-14T08:00:00.000+00:00",
  due_on: "2026-11-21",
  seller: {
    legal_name: "Verifymzansi (Pty) Ltd",
    registration_number: "2026/155305/07",
    vat_registered: false,
  },
  buyer: null,
  revision: 1,
  term_days: 90,
  slots: 3,
  unit_price_cents: 20700,
  total_cents: 62100,
  description: "3 × Individual slot — 90 days",
  currency: "ZAR",
  payment_reference: "VM-2026-000001",
  cooling_off_consent_at: null,
  cooling_off_consent_version: null,
  consent: {
    version: "invoice-cooling-off-v1",
    wording:
      "My slots start as soon as this invoice is paid; the 7-day cooling-off does not apply because the service starts immediately.",
  },
  paid_at: null,
  payment_id: null,
  payment_status: null,
  voided_at: null,
  transfer_waiting: false,
  latest_attempt: null,
} satisfies CustomerInvoice;

/** Obviously fake bank details (never a real account). */
export const FAKE_INVOICE_BANK = {
  accountName: "Example Trading Account",
  bankName: "Example Bank",
  accountNumber: "0000000000",
  branchCode: "000000",
};
