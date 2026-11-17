import { afterEach, describe, expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import {
  FoundationInvoiceError,
  invoiceRouteRefusal,
  issueStaffInvoice,
  readMyInvoice,
  recordStaffInvoiceTransfer,
  readMyInvoices,
  readStaffInvoice,
  saveMyInvoiceBilling,
  startMyInvoicePayment,
  voidStaffInvoice,
} from "./customer-invoices";
import { FoundationBillingError, openFoundationInvoiceCheckout } from "./billing-runtime";
import type * as BillingRuntime from "./billing-runtime";
import { FoundationStaffCommandError } from "./staff-command";
import type { FoundationServiceApi } from "./service-api";
import { FIXTURE_INVOICE } from "@/test/customer-invoice";

vi.mock("server-only", () => ({}));
vi.mock("./service-api", () => ({ createFoundationServiceApi: vi.fn(() => ({})) }));
vi.mock("./billing-runtime", async (original) => ({
  ...(await original<typeof BillingRuntime>()),
  openFoundationInvoiceCheckout: vi.fn(),
}));

const invoiceId = "11111111-1111-4111-8111-111111111111";
const owner = "22222222-2222-4222-8222-222222222222";
const paymentId = "33333333-3333-4333-8333-333333333333";
const ok = (data: unknown) => ({ data, error: null });
const refused = (code: string, details?: string, message = "refused") => ({
  data: null,
  error: { code, details, message },
});
const fixture = (...answers: unknown[]) => {
  const rpc = vi.fn();
  for (const answer of answers) rpc.mockResolvedValueOnce(answer);
  return { rpc, api: { rpc } as unknown as FoundationAuthenticatedApi };
};
const service = {} as FoundationServiceApi;
const invoice = FIXTURE_INVOICE;
const staffView = {
  ...invoice,
  account_id: owner,
  customer_email: "thandi@example.test",
  customer_name: "Thandi D.",
  issued_by_me: true,
  issued_by_name: "Sipho F.",
  issue_reason: "Invoice requested by email",
  void_reason: null,
  attempts: 0,
  extra_payments: [],
};
const quote = {
  payment_id: paymentId,
  merchant_reference: "VM-2026-000001",
  amount_cents: "62100",
  currency: "ZAR",
  status: "pending",
  slots: 3,
  reused: false,
};
afterEach(() => vi.clearAllMocks());

describe("customer invoice reads", () => {
  it("reads the member's own invoice and parses it strictly", async () => {
    const { rpc, api } = fixture(ok(invoice));
    await expect(readMyInvoice(api, " vm-2026-000001 ")).resolves.toMatchObject({
      invoice_number: "VM-2026-000001",
      total_cents: 62100,
    });
    expect(rpc).toHaveBeenCalledWith(
      "get_my_invoice",
      { p_invoice_number: "VM-2026-000001" },
      { get: false }
    );
  });

  it("answers null for someone else's or a malformed number, without asking for a malformed one", async () => {
    const { rpc, api } = fixture(refused("PT404", "invoice_unavailable", "invoice not found"));
    await expect(readMyInvoice(api, "VM-2026-000002")).resolves.toBeNull();
    await expect(readMyInvoice(api, "../admin")).resolves.toBeNull();
    await expect(readMyInvoice(api, "%E0")).resolves.toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("refuses an answer of another shape (for example a VAT-registered seller)", async () => {
    const { api } = fixture(
      ok({ ...invoice, seller: { ...invoice.seller, vat_registered: true } })
    );
    await expect(readMyInvoice(api, "VM-2026-000001")).rejects.toMatchObject({ status: 503 });
  });

  it("lists the member's invoices", async () => {
    const item = {
      invoice_number: "VM-2026-000001",
      status: "paid",
      issued_at: invoice.issued_at,
      due_on: invoice.due_on,
      description: invoice.description,
      total_cents: 62100,
      paid_at: "2026-11-15T08:00:00.000+00:00",
      payment_status: "complete",
    };
    const { api } = fixture(ok({ items: [item] }));
    await expect(readMyInvoices(api)).resolves.toEqual([item]);
  });
});

describe("billing details and Pay now", () => {
  it("saves billing details at the shown revision", async () => {
    const { rpc, api } = fixture(
      ok({
        ...invoice,
        revision: 2,
        buyer: { name: "Fixture Traders", address: "1 Example Road", registration_number: null },
        repeated: false,
      })
    );
    await saveMyInvoiceBilling(api, {
      invoiceNumber: "VM-2026-000001",
      revision: 1,
      buyerName: "Fixture Traders",
      buyerAddress: "1 Example Road",
      buyerRegistrationNumber: "  ",
    });
    expect(rpc).toHaveBeenCalledWith(
      "save_my_invoice_billing",
      {
        p_invoice_number: "VM-2026-000001",
        p_revision: 1,
        p_buyer_name: "Fixture Traders",
        p_buyer_address: "1 Example Road",
        p_buyer_registration_number: null,
      },
      { get: false }
    );
  });

  it("puts the database's refusals in the member's words", async () => {
    const { api } = fixture(
      refused("PT409", "invoice_revision_changed"),
      refused("PT409", "invoice_paid"),
      refused("PT429", "invoice_attempts_exhausted"),
      refused("42501", undefined, "live session required"),
      refused("XX000")
    );
    const save = () =>
      saveMyInvoiceBilling(api, {
        invoiceNumber: "VM-2026-000001",
        revision: 1,
        buyerName: "Fixture Traders",
        buyerAddress: "1 Example Road",
      });
    await expect(save()).rejects.toMatchObject({ status: 409, message: /changed/ });
    await expect(save()).rejects.toMatchObject({ status: 409, message: /already paid/ });
    await expect(save()).rejects.toMatchObject({ status: 429, message: /billing@/ });
    await expect(save()).rejects.toMatchObject({ status: 403, code: "member_required" });
    await expect(save()).rejects.toMatchObject({ status: 503 });
  });

  it("refuses Pay now without the cooling-off box, before any call", async () => {
    const { rpc, api } = fixture();
    await expect(
      startMyInvoicePayment(
        api,
        owner,
        { invoiceNumber: "VM-2026-000001", expectedTotalCents: 62100, coolingOffConsent: false },
        "https://verifymzansi.com",
        service
      )
    ).rejects.toMatchObject({ status: 422 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("starts the invoice's payment with the shown total, then opens its Ozow request", async () => {
    const { rpc, api } = fixture(ok(quote));
    vi.mocked(openFoundationInvoiceCheckout).mockResolvedValue({
      paymentId,
      checkoutUrl: "https://pay.ozow.com/fixture",
    });
    await expect(
      startMyInvoicePayment(
        api,
        owner,
        { invoiceNumber: "VM-2026-000001", expectedTotalCents: 62100, coolingOffConsent: true },
        "https://verifymzansi.com",
        service
      )
    ).resolves.toEqual({ paymentId, checkoutUrl: "https://pay.ozow.com/fixture" });
    expect(rpc).toHaveBeenCalledWith(
      "start_invoice_payment",
      {
        p_invoice_number: "VM-2026-000001",
        p_expected_total_cents: 62100,
        p_cooling_off_consent: true,
      },
      { get: false }
    );
    expect(openFoundationInvoiceCheckout).toHaveBeenCalledWith(
      quote,
      owner,
      "https://verifymzansi.com",
      service
    );
  });

  it("never opens a payment that is not this invoice's", async () => {
    const { api } = fixture(ok({ ...quote, merchant_reference: "VM-2026-000009" }));
    await expect(
      startMyInvoicePayment(
        api,
        owner,
        { invoiceNumber: "VM-2026-000001", expectedTotalCents: 62100, coolingOffConsent: true },
        "https://verifymzansi.com",
        service
      )
    ).rejects.toMatchObject({ status: 503 });
    expect(openFoundationInvoiceCheckout).not.toHaveBeenCalled();
  });

  it("maps refusals to route answers and leaves outages to the route", () => {
    expect(invoiceRouteRefusal(new FoundationInvoiceError(409, "Paid", "invoice_refused"))).toEqual(
      { status: 409, error: "Paid", reason: "invoice_refused" }
    );
    expect(
      invoiceRouteRefusal(new FoundationBillingError(409, "Being checked", "PAYMENT_BEING_CHECKED"))
    ).toMatchObject({ status: 409, reason: "PAYMENT_BEING_CHECKED" });
    expect(invoiceRouteRefusal(new FoundationBillingError(503))).toBeNull();
    expect(invoiceRouteRefusal(new Error("x"))).toBeNull();
  });
});

describe("staff invoice commands", () => {
  it("records a bank transfer to an invoice with the bank reference as typed", async () => {
    const { rpc, api } = fixture(
      ok({
        transfer_id: invoiceId,
        status: "awaiting_confirmation",
        invoice_number: "VM-2026-000001",
        repeated: false,
        reason: "Invoice VM-2026-000001: EFT cleared",
      })
    );
    await expect(
      recordStaffInvoiceTransfer(api, {
        invoiceNumber: "VM-2026-000001",
        bankReference: "  FNB   2026-11 ",
        clearedOn: "2026-11-14",
        coolingOffWaiver: true,
        reason: "EFT cleared on the statement",
      })
    ).resolves.toMatchObject({ status: "awaiting_confirmation", repeated: false });
    expect(rpc).toHaveBeenCalledWith(
      "record_staff_invoice_transfer",
      {
        p_invoice_number: "VM-2026-000001",
        p_bank_reference: "FNB 2026-11",
        p_cleared_on: "2026-11-14",
        p_cooling_off_waiver: true,
        p_reason: "EFT cleared on the statement",
      },
      { get: false }
    );
    await expect(
      recordStaffInvoiceTransfer(api, {
        invoiceNumber: "VM-2026-000001",
        bankReference: "FNB 2026-11",
        clearedOn: "2026-11-14",
        coolingOffWaiver: false,
        reason: "EFT cleared on the statement",
      })
    ).rejects.toMatchObject({ status: 422 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("explains a transfer or Pay now refused while another waits", async () => {
    const { api } = fixture(
      refused("PT409", "invoice_transfer_waiting"),
      refused("PT409", "invoice_transfer_waiting")
    );
    await expect(
      recordStaffInvoiceTransfer(api, {
        invoiceNumber: "VM-2026-000001",
        bankReference: "FNB 2026-11",
        clearedOn: "2026-11-14",
        coolingOffWaiver: true,
        reason: "EFT cleared on the statement",
      })
    ).rejects.toMatchObject({ status: 409, message: /waits for a second staff member/ });
    await expect(
      startMyInvoicePayment(
        api,
        owner,
        { invoiceNumber: "VM-2026-000001", expectedTotalCents: 62100, coolingOffConsent: true },
        "https://verifymzansi.com",
        service
      )
    ).rejects.toMatchObject({ status: 409, message: /do not need to pay again/ });
  });

  it("issues an invoice with the request id and the audited reason", async () => {
    const { rpc, api } = fixture(ok({ ...staffView, repeated: false }));
    await issueStaffInvoice(api, {
      accountEmail: " thandi@example.test ",
      termDays: 90,
      slots: 3,
      dueDays: 7,
      reason: "Invoice requested by email",
      requestId: invoiceId,
    });
    expect(rpc).toHaveBeenCalledWith(
      "issue_staff_invoice",
      {
        p_account_email: "thandi@example.test",
        p_term_days: 90,
        p_slots: 3,
        p_due_days: 7,
        p_reason: "Invoice requested by email",
        p_request_id: invoiceId,
      },
      { get: false }
    );
  });

  it("puts staff refusals in plain words and keeps the second-factor redirect", async () => {
    const { api } = fixture(
      refused("PT412", "invoice_buyer_unverified"),
      refused("PT409", "invoice_payment_open"),
      refused("42501", undefined, "recent second-factor verification required")
    );
    const issue = () =>
      issueStaffInvoice(api, {
        accountEmail: "thandi@example.test",
        termDays: 30,
        slots: 1,
        dueDays: 7,
        reason: "Invoice requested by email",
        requestId: invoiceId,
      });
    await expect(issue()).rejects.toMatchObject({ status: 409, message: /ID review/ });
    await expect(
      voidStaffInvoice(api, invoiceId, "Issued for the wrong term")
    ).rejects.toMatchObject({ status: 409, message: /still open at Ozow/ });
    const mfa = await issue().catch((error: unknown) => error);
    expect(mfa).toBeInstanceOf(FoundationStaffCommandError);
    expect(mfa).toMatchObject({ status: 403, mfaRequired: true });
  });

  it("reads one invoice as staff, null when there is none", async () => {
    const { rpc, api } = fixture(ok(staffView), refused("PT404", "invoice_unavailable"));
    await expect(readStaffInvoice(api, "VM-2026-000001")).resolves.toMatchObject({
      customer_email: "thandi@example.test",
    });
    await expect(readStaffInvoice(api, "VM-2026-000002")).resolves.toBeNull();
    await expect(readStaffInvoice(api, "nope")).resolves.toBeNull();
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
