/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { POST } from "./route";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { checkRateLimit } from "@/lib/utils/rate-limit";
vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: () => ({}),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture" }),
}));
vi.mock("@/lib/services/email", () => ({ sendOrganisationAdminInviteEmail: vi.fn() }));

const payment = "11111111-1111-4111-8111-111111111111",
  line = "22222222-2222-4222-8222-222222222222",
  csrf = "c".repeat(64),
  rpc = vi.fn();
function request(body: unknown) {
  return new NextRequest("https://verifymzansi.com/api/admin/commercial", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      origin: "https://verifymzansi.com",
      "content-type": "application/json",
      cookie: `vm_csrf=${csrf}`,
      "x-csrf-token": csrf,
    },
  });
}
const refundReply = {
  request_id: line,
  status: "applied",
  kind: "refunded",
  released_activations: 1,
  payment_status: "refunded",
  repeated: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate: async () => ({ rpc }),
    respond: (response: NextResponse) => response,
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
});
afterEach(() => vi.unstubAllEnvs());

it("refuses a refund without a reference before any database call", async () => {
  const response = await POST(
    request({
      action: "payment.reverse",
      paymentId: payment,
      kind: "refunded",
      reasonCode: "billing_error",
      reason: "Charged twice by mistake",
    })
  );
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ error: "Enter the refund reference." });
  expect(rpc).not.toHaveBeenCalled();
});

it("refuses a refund without a reason code", async () => {
  const response = await POST(
    request({
      action: "payment.reverse",
      paymentId: payment,
      kind: "refunded",
      ozowReference: "OZ-REF-1",
      reason: "Charged twice by mistake",
    })
  );
  expect(response.status).toBe(422);
  expect(rpc).not.toHaveBeenCalled();
});

it("records a whole-payment refund and a slot refund with the new commands", async () => {
  rpc.mockResolvedValue({ data: refundReply, error: null });
  const whole = await POST(
    request({
      action: "payment.reverse",
      paymentId: payment.toUpperCase(),
      kind: "refunded",
      reasonCode: "duplicate",
      ozowReference: "OZ-REF-1",
      reason: "Charged twice by mistake",
    })
  );
  expect(whole.status).toBe(200);
  expect(rpc).toHaveBeenLastCalledWith(
    "record_staff_payment_refund",
    {
      p_payment_id: payment,
      p_kind: "refunded",
      p_reason_code: "duplicate",
      p_reason: "Charged twice by mistake",
      p_ozow_reference: "OZ-REF-1",
    },
    { get: false }
  );
  rpc.mockResolvedValue({ data: { ...refundReply, line_id: line }, error: null });
  const slot = await POST(
    request({
      action: "payment.reverse_slot",
      lineId: line,
      kind: "chargeback",
      reasonCode: "s14_cancellation",
      ozowReference: "OZ-CB-1",
      reason: "Bank chargeback on one slot",
    })
  );
  expect(slot.status).toBe(200);
  expect(rpc).toHaveBeenLastCalledWith(
    "record_staff_slot_refund",
    expect.objectContaining({ p_line_id: line, p_kind: "chargeback", p_ozow_reference: "OZ-CB-1" }),
    { get: false }
  );
});

it("activates a paid but undelivered payment and approves a waiting refund", async () => {
  rpc.mockResolvedValueOnce({
    data: {
      payment_id: payment,
      fulfillment_status: "fulfilled",
      entitlements: 1,
      addon_window: false,
      commissions: 0,
      repeated: false,
    },
    error: null,
  });
  const activated = await POST(
    request({ action: "payment.activate", paymentId: payment, reason: "Paid after cancel" })
  );
  expect(activated.status).toBe(200);
  expect(rpc).toHaveBeenLastCalledWith(
    "activate_staff_paid_payment",
    { p_payment_id: payment, p_reason: "Paid after cancel" },
    { get: false }
  );
  rpc.mockResolvedValueOnce({
    data: null,
    error: { code: "42501", details: "refund_approver_same", message: "refused" },
  });
  const approved = await POST(request({ action: "payment.refund_approve", requestId: line }));
  expect(approved.status).toBe(403);
  expect(await approved.json()).toMatchObject({
    error: "Another staff member must approve this refund: you recorded it.",
  });
});

const transfer = {
  action: "payment.record_transfer",
  accountEmail: "thandi@example.test",
  termDays: 30,
  slots: 2,
  amountCents: 13800,
  bankReference: "FNB 2026-11 A1",
  clearedOn: "2026-11-13",
  coolingOffWaiver: true,
  reason: "EFT cleared; written waiver on file",
};

const waitingRecord = {
  transfer_id: line,
  status: "awaiting_confirmation",
  account_id: payment,
  customer_email: "thandi@example.test",
  similar_records: 0,
  customer_name: "Thandi D.",
  term_days: 30,
  slots: 2,
  amount_received_cents: 13800,
  bank_reference: "FNB 2026-11 A1",
  cleared_on: "2026-11-13",
  reason: "EFT cleared; written waiver on file",
  recorded_at: "2026-11-13T10:00:00.000+00:00",
  recorded_by_me: true,
  recorded_by_name: null,
  payment_id: null,
};

it("confirms a waiting transfer, and refuses the recorder in plain words", async () => {
  rpc.mockResolvedValueOnce({
    data: {
      ...waitingRecord,
      status: "confirmed",
      recorded_by_me: false,
      payment_id: payment,
      commissions: 0,
      slots_started: 2,
      ends_at: "2026-12-13T10:00:00.000+00:00",
      repeated: false,
    },
    error: null,
  });
  const confirmed = await POST(request({ action: "payment.transfer_confirm", transferId: line }));
  expect(confirmed.status).toBe(200);
  expect(rpc).toHaveBeenLastCalledWith(
    "confirm_staff_invoice_payment",
    { p_transfer_id: line },
    { get: false }
  );
  rpc.mockResolvedValueOnce({
    data: null,
    error: { code: "42501", details: "transfer_confirmer_same", message: "refused" },
  });
  const own = await POST(request({ action: "payment.transfer_confirm", transferId: line }));
  expect(own.status).toBe(403);
  expect(await own.json()).toMatchObject({
    error: "Another staff member must confirm this bank transfer: you recorded it.",
  });
  rpc.mockResolvedValueOnce({
    data: { ...waitingRecord, status: "declined", repeated: false },
    error: null,
  });
  const declined = await POST(
    request({
      action: "payment.transfer_decline",
      transferId: line,
      reason: "The bank shows no such transfer",
    })
  );
  expect(declined.status).toBe(200);
  expect(rpc).toHaveBeenLastCalledWith(
    "decline_staff_invoice_payment",
    { p_transfer_id: line, p_reason: "The bank shows no such transfer" },
    { get: false }
  );
});

it("records a cleared bank transfer with the staff command", async () => {
  rpc.mockResolvedValueOnce({ data: { ...waitingRecord, repeated: false }, error: null });
  const response = await POST(request(transfer));
  expect(response.status).toBe(200);
  expect(rpc).toHaveBeenLastCalledWith(
    "record_staff_invoice_payment",
    {
      p_account_email: "thandi@example.test",
      p_term_days: 30,
      p_slots: 2,
      p_amount_cents: 13800,
      p_bank_reference: "FNB 2026-11 A1",
      p_cleared_on: "2026-11-13",
      p_cooling_off_waiver: true,
      p_reason: "EFT cleared; written waiver on file",
    },
    { get: false }
  );
});

it("refuses a bank transfer without the written waiver or with a bad term before any call", async () => {
  const unticked = await POST(request({ ...transfer, coolingOffWaiver: false }));
  expect(unticked.status).toBe(422);
  expect(await unticked.json()).toMatchObject({
    error: "Confirm the customer agreed in writing to the cooling-off waiver.",
  });
  const term = await POST(request({ ...transfer, termDays: 60 }));
  expect(term.status).toBe(422);
  const date = await POST(request({ ...transfer, clearedOn: "13/11/2026" }));
  expect(date.status).toBe(422);
  expect(rpc).not.toHaveBeenCalled();
});
