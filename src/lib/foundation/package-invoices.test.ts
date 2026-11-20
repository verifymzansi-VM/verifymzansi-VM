import { afterEach, describe, expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { FoundationInvoiceError, invoiceRouteRefusal } from "./customer-invoices";
import {
  approveStaffPackageInvoice,
  declineStaffPackageInvoiceRequest,
  issueStaffPackageInvoice,
  readMyPackageInvoiceRequest,
  readStaffPackageInvoiceRequests,
  requestPackageAddInvoice,
  requestPackageInvoice,
} from "./package-invoices";
import { FoundationStaffCommandError } from "./staff-command";
import { FIXTURE_INVOICE } from "@/test/customer-invoice";

vi.mock("server-only", () => ({}));
vi.mock("./service-api", () => ({ createFoundationServiceApi: vi.fn(() => ({})) }));

const planId = "11111111-2222-4333-8444-555555555590";
const requestId = "44444444-4444-4444-8444-444444444444";
const owner = "22222222-2222-4222-8222-222222222222";
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
const request = {
  request_id: requestId,
  status: "requested",
  term_days: 90,
  slots: 50,
  unit_price_cents: 30000,
  total_cents: 1500000,
  requested_at: "2026-11-19T08:00:00+00:00",
  invoice_number: null,
  closed_at: null,
};
const staffRequest = {
  ...request,
  account_id: owner,
  customer_email: "dealer@example.test",
  customer_name: "Thandi D.",
  identity_accepted: true,
  package_open: false,
  needs_approval: false,
  due_days: null,
  staff_reason: null,
  prepared_at: null,
  prepared_by_me: false,
  prepared_by_name: null,
  close_reason: null,
};
/** A package invoice as staff read it: 100 slots for 180 days (R60 000). */
const packageInvoice = {
  ...FIXTURE_INVOICE,
  term_days: 180,
  slots: 100,
  unit_price_cents: 60000,
  total_cents: 6000000,
  description: "Multi-listing package: 100 slots × 180 days",
  account_id: owner,
  customer_email: "dealer@example.test",
  customer_name: "Thandi D.",
  issued_by_me: false,
  issued_by_name: "Sipho F.",
  issue_reason: "Dealer order, 100 slots",
  void_reason: null,
  attempts: 0,
  extra_payments: [],
};
const order = {
  planId,
  slots: 50,
  expectedTotalCents: 1500000,
  coolingOffConsent: true,
  requestId,
};
afterEach(() => vi.clearAllMocks());

describe("Ask for an invoice (member)", () => {
  it("sends the order with the request id and parses the answer strictly", async () => {
    const { rpc, api } = fixture(ok({ ...request, repeated: false }));
    await expect(requestPackageInvoice(api, order)).resolves.toMatchObject({
      status: "requested",
      total_cents: 1500000,
    });
    expect(rpc).toHaveBeenCalledWith(
      "request_package_invoice",
      {
        p_plan_id: planId,
        p_slots: 50,
        p_expected_total_cents: 1500000,
        p_cooling_off_consent: true,
        p_request_id: requestId,
      },
      { get: false }
    );
  });

  it("never asks without the tick, and refuses fewer than 5 slots before the database", async () => {
    const { rpc, api } = fixture();
    await expect(
      requestPackageInvoice(api, { ...order, coolingOffConsent: false })
    ).rejects.toMatchObject({ status: 422 });
    await expect(requestPackageInvoice(api, { ...order, slots: 4 })).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["PT403", "packages_not_on_sale", 403, /not on sale/],
    ["PT409", "package_active", 409, /already has a Multi-listing package/],
    ["PT409", "package_invoice_unpaid", 409, /not paid yet/],
    ["PT409", "package_invoice_request_open", 409, /preparing your invoice/],
    ["PT412", undefined, 403, /ID review must be accepted/],
    ["PT428", undefined, 409, /price changed/],
    ["PT429", "package_invoice_requests_limit", 429, /many invoices today/],
  ] as const)("puts %s %s in plain words", async (code, detail, status, message) => {
    const { api } = fixture(refused(code, detail));
    const error = await requestPackageInvoice(api, order).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FoundationInvoiceError);
    expect(invoiceRouteRefusal(error)).toMatchObject({
      status,
      error: expect.stringMatching(message),
    });
  });

  it("refuses an answer with unknown fields", async () => {
    const { api } = fixture(ok({ ...request, repeated: false, customer_email: "x@example.test" }));
    await expect(requestPackageInvoice(api, order)).rejects.toMatchObject({ status: 503 });
  });

  it("reads the member's latest request, or null", async () => {
    const { api } = fixture(ok({ request }), ok({ request: null }));
    await expect(readMyPackageInvoiceRequest(api)).resolves.toMatchObject({ slots: 50 });
    await expect(readMyPackageInvoiceRequest(api)).resolves.toBeNull();
  });
});

describe("Ask for an invoice for added slots (member, P4b)", () => {
  const packageId = "55555555-5555-4555-8555-555555555555";
  const addRequest = {
    ...request,
    term_days: 30,
    slots: 2,
    unit_price_cents: 12667,
    total_cents: 25334,
    kind: "add",
    days_left: 38,
    invoiced_days: null,
    days_left_now: 38,
    package_ends_at: "2026-12-24T08:00:00+00:00",
  };
  const addOrder = {
    packageId,
    slots: 2,
    expectedTotalCents: 25334,
    coolingOffConsent: true,
    requestId,
  };

  it("sends the package, slots, total and request id, and reads an add answer", async () => {
    const { rpc, api } = fixture(ok({ ...addRequest, repeated: false }));
    await expect(requestPackageAddInvoice(api, addOrder)).resolves.toMatchObject({
      kind: "add",
      days_left: 38,
      slots: 2,
    });
    expect(rpc).toHaveBeenCalledWith(
      "request_package_add_invoice",
      {
        p_package_id: packageId,
        p_slots: 2,
        p_expected_total_cents: 25334,
        p_cooling_off_consent: true,
        p_request_id: requestId,
      },
      { get: false }
    );
  });

  it("never asks without the tick", async () => {
    const { rpc, api } = fixture();
    await expect(
      requestPackageAddInvoice(api, { ...addOrder, coolingOffConsent: false })
    ).rejects.toMatchObject({ status: 422 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["PT409", "package_ended", 409, /package has ended/],
    ["PT409", "package_add_invoice_too_late", 409, /10 or more days/],
    ["22023", "package_slots_invalid", 422, /at most 250 slots/],
  ] as const)("puts %s %s in plain words", async (code, detail, status, message) => {
    const { api } = fixture(refused(code, detail));
    const error = await requestPackageAddInvoice(api, addOrder).catch((caught: unknown) => caught);
    expect(invoiceRouteRefusal(error)).toMatchObject({
      status,
      error: expect.stringMatching(message),
    });
  });

  it("reads an add request as the member's latest request and in the staff queue", async () => {
    const { api } = fixture(
      ok({ request: addRequest }),
      ok({
        items: [{ ...staffRequest, ...addRequest, package_open: true }],
        open: 1,
        approval_above_cents: 5000000,
      })
    );
    await expect(readMyPackageInvoiceRequest(api)).resolves.toMatchObject({ kind: "add" });
    await expect(readStaffPackageInvoiceRequests(api)).resolves.toMatchObject({
      items: [{ kind: "add", slots: 2 }],
    });
  });

  it("still refuses a new-package request of fewer than 5 slots", async () => {
    const { api } = fixture(ok({ request: { ...request, slots: 2 } }));
    await expect(readMyPackageInvoiceRequest(api)).rejects.toMatchObject({ status: 503 });
  });
});

describe("package invoice requests (staff)", () => {
  it("reads the open requests", async () => {
    const { api } = fixture(ok({ items: [staffRequest], open: 1, approval_above_cents: 5000000 }));
    await expect(readStaffPackageInvoiceRequests(api)).resolves.toMatchObject({
      open: 1,
      items: [{ customer_email: "dealer@example.test" }],
    });
  });

  it("issues, prepares above R50 000 and approves with the invoice in the answer", async () => {
    const issued = {
      ...staffRequest,
      status: "issued",
      invoice_number: "VM-2026-000001",
      invoice: { ...packageInvoice, total_cents: 1500000, slots: 50, term_days: 90 },
      repeated: false,
    };
    const prepared = {
      ...staffRequest,
      status: "awaiting_approval",
      needs_approval: true,
      due_days: 14,
      staff_reason: "Dealer order, 100 slots",
      prepared_at: "2026-11-19T08:05:00+00:00",
      prepared_by_me: true,
      prepared_by_name: "Sipho F.",
      invoice: null,
      repeated: false,
    };
    const approved = {
      ...prepared,
      status: "issued",
      prepared_by_me: false,
      invoice_number: "VM-2026-000002",
      invoice: packageInvoice,
    };
    const { rpc, api } = fixture(ok(issued), ok(prepared), ok(approved));
    await expect(
      issueStaffPackageInvoice(api, { requestId, dueDays: 7, reason: "Asked at checkout" })
    ).resolves.toMatchObject({ status: "issued", invoice: { total_cents: 1500000 } });
    await expect(
      issueStaffPackageInvoice(api, { requestId, dueDays: 14, reason: "Dealer order, 100 slots" })
    ).resolves.toMatchObject({ status: "awaiting_approval", invoice: null });
    await expect(approveStaffPackageInvoice(api, requestId)).resolves.toMatchObject({
      invoice: { total_cents: 6000000, slots: 100 },
    });
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "issue_staff_package_invoice",
      { p_request_id: requestId, p_due_days: 7, p_reason: "Asked at checkout" },
      { get: false }
    );
    expect(rpc).toHaveBeenNthCalledWith(
      3,
      "approve_staff_package_invoice",
      { p_request_id: requestId },
      { get: false }
    );
  });

  it.each([
    ["42501", "invoice_approver_same", 403, /you prepared it/],
    ["PT409", "invoice_preparer_inactive", 409, /can no longer issue invoices/],
    ["PT409", "package_invoice_request_closed", 409, /already handled/],
    ["PT404", "package_invoice_request_unavailable", 404, /No such invoice request/],
  ] as const)(
    "puts the staff refusal %s %s in plain words",
    async (code, detail, status, message) => {
      const { api } = fixture(refused(code, detail));
      const error = await approveStaffPackageInvoice(api, requestId).catch(
        (caught: unknown) => caught
      );
      expect(error).toBeInstanceOf(FoundationStaffCommandError);
      expect(error).toMatchObject({ status, message: expect.stringMatching(message) });
    }
  );

  it("declines with a reason", async () => {
    const { rpc, api } = fixture(
      ok({
        ...staffRequest,
        status: "declined",
        closed_at: "2026-11-19T09:00:00+00:00",
        close_reason: "Customer asked us to cancel it",
        repeated: false,
      })
    );
    await expect(
      declineStaffPackageInvoiceRequest(api, requestId, "Customer asked us to cancel it")
    ).resolves.toMatchObject({ status: "declined" });
    expect(rpc).toHaveBeenCalledWith(
      "decline_staff_package_invoice_request",
      { p_request_id: requestId, p_reason: "Customer asked us to cancel it" },
      { get: false }
    );
  });
});
