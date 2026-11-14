import { afterEach, describe, expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import {
  activateStaffPaidPayment,
  approveStaffPaymentRefund,
  declineStaffPaymentRefund,
  readStaffPaymentList,
  recordStaffPaymentRefund,
  recordStaffSlotRefund,
} from "./staff-payments";

vi.mock("server-only", () => ({}));

const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const date = "2026-11-13T10:00:00Z";
const reason = "Charged twice by mistake";
const ok = (data: unknown) => ({ data, error: null });
const refused = (code: string, details?: string, message = "refused") => ({
  data: null,
  error: { code, details, message },
});
const fixture = (data: unknown) => {
  const rpc = vi.fn().mockResolvedValue(ok(data));
  return { rpc, api: { rpc } as unknown as FoundationAuthenticatedApi };
};
const refund = {
  kind: "refunded" as const,
  reasonCode: "billing_error" as const,
  reason,
  ozowReference: " OZ-REF-1 ",
};
afterEach(() => vi.resetAllMocks());

const item = {
  id,
  user_id: other,
  area: "all",
  amount_cents: 13800,
  status: "complete",
  fulfillment_status: "needs_reconciliation",
  product_kind: "plan",
  created_at: date,
  completed_at: date,
  merchant_reference: "abc123",
  description: "Individual slot — 30 days",
  reversed: false,
  activated_at: null,
  lines: [{ id: other, line_number: 1, amount_cents: 6900, status: "open", reversal_kind: null }],
  refund_request: null,
};

describe("staff payment adapters", () => {
  it("reads the list with its filter and both counts", async () => {
    const { rpc, api } = fixture({
      total: 1,
      page: 1,
      needs_attention: 1,
      awaiting_approval: 0,
      items: [item],
    });
    await expect(readStaffPaymentList(api, 1, "needs_attention")).resolves.toMatchObject({
      needs_attention: 1,
      items: [{ fulfillment_status: "needs_reconciliation" }],
    });
    expect(rpc).toHaveBeenCalledWith(
      "get_staff_payment_list",
      { p_page: 1, p_filter: "needs_attention" },
      { get: false }
    );
    rpc.mockResolvedValueOnce(
      ok({
        total: 1,
        page: 1,
        needs_attention: 1,
        awaiting_approval: 0,
        items: [{ ...item, extra: 1 }],
      })
    );
    await expect(readStaffPaymentList(api, 1)).rejects.toMatchObject({ status: 503 });
  });

  it("refuses a refund without a usable reference before calling the database", async () => {
    const { rpc, api } = fixture({});
    await expect(
      recordStaffPaymentRefund(api, id, { ...refund, ozowReference: "  " })
    ).rejects.toMatchObject({ status: 422, message: "Enter the refund reference." });
    for (const ozowReference of ["has;semicolon", " A.", "x".repeat(101)])
      await expect(
        recordStaffSlotRefund(api, id, { ...refund, ozowReference })
      ).rejects.toMatchObject({
        status: 422,
        message: "The reference is 4 to 100 letters, digits, spaces or . _ : / -.",
      });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends a bank refund reference with its spaces collapsed; the database decides by method", async () => {
    const { rpc, api } = fixture({
      request_id: other,
      status: "applied",
      kind: "refunded",
      line_id: other,
      released_activations: 0,
      payment_status: "complete",
      repeated: false,
    });
    await recordStaffSlotRefund(api, id, { ...refund, ozowReference: "  FNB   Refund\t001 " });
    expect(rpc).toHaveBeenCalledWith(
      "record_staff_slot_refund",
      expect.objectContaining({ p_ozow_reference: "FNB Refund 001" }),
      { get: false }
    );
    // A bank transfer's refusals never mention Ozow; an Ozow payment's keep their words.
    const cases: [ReturnType<typeof refused>, number, string][] = [
      [
        refused("22023", "refund_reference_invalid"),
        422,
        "The bank reference is 4 to 100 letters, digits, spaces or . _ : / -.",
      ],
      [
        refused("22023", "refund_reference_required"),
        422,
        "Enter the bank reference of the transfer back.",
      ],
      [
        refused("PT409", "refund_reference_used"),
        409,
        "That bank reference was already recorded for another refund.",
      ],
      [
        refused("22023", "ozow_reference_invalid"),
        422,
        "Ozow's reference is 4 to 100 letters, digits or . _ : / - with no spaces.",
      ],
    ];
    for (const [error, status, message] of cases) {
      rpc.mockResolvedValueOnce(error);
      await expect(recordStaffPaymentRefund(api, id, refund)).rejects.toMatchObject({
        status,
        message,
      });
    }
  });

  it("sends the reference, reason code and note, and accepts a waiting refund", async () => {
    const { rpc, api } = fixture({
      request_id: other,
      status: "awaiting_approval",
      kind: "refunded",
      released_activations: null,
      payment_status: "complete",
      repeated: false,
    });
    await expect(recordStaffPaymentRefund(api, id, refund)).resolves.toMatchObject({
      status: "awaiting_approval",
    });
    expect(rpc).toHaveBeenCalledWith(
      "record_staff_payment_refund",
      {
        p_payment_id: id,
        p_kind: "refunded",
        p_reason_code: "billing_error",
        p_reason: reason,
        p_ozow_reference: "OZ-REF-1",
      },
      { get: false }
    );
  });

  it("explains the database's refusals in staff words", async () => {
    const { rpc, api } = fixture({});
    rpc.mockResolvedValueOnce(refused("PT409", "ozow_reference_used"));
    await expect(recordStaffPaymentRefund(api, id, refund)).rejects.toMatchObject({
      status: 409,
      message: "That Ozow reference was already recorded for another refund.",
    });
    rpc.mockResolvedValueOnce(refused("42501", "refund_approver_same"));
    await expect(approveStaffPaymentRefund(api, id)).rejects.toMatchObject({
      status: 403,
      message: "Another staff member must approve this refund: you recorded it.",
    });
    rpc.mockResolvedValueOnce(
      refused("42501", undefined, "a different staff member must record this reversal")
    );
    await expect(recordStaffSlotRefund(api, id, refund)).rejects.toMatchObject({
      status: 403,
      message: "Another staff member must handle a payment of your own.",
    });
    rpc.mockResolvedValueOnce(refused("PT429", "slot_limit_reached"));
    await expect(activateStaffPaidPayment(api, id, reason)).rejects.toMatchObject({
      status: 409,
      message: "The person would hold more slots than their limit. Raise the limit or refund.",
    });
    rpc.mockResolvedValueOnce(
      refused("42501", undefined, "staff second-factor verification expired")
    );
    await expect(activateStaffPaidPayment(api, id, reason)).rejects.toMatchObject({
      status: 403,
      mfaRequired: true,
    });
  });

  it("activates with an audited reason and checks the reply", async () => {
    const { rpc, api } = fixture({
      payment_id: id,
      fulfillment_status: "fulfilled",
      entitlements: 2,
      addon_window: false,
      commissions: 2,
      repeated: false,
    });
    await expect(activateStaffPaidPayment(api, id, reason)).resolves.toMatchObject({
      entitlements: 2,
    });
    expect(rpc).toHaveBeenCalledWith(
      "activate_staff_paid_payment",
      { p_payment_id: id, p_reason: reason },
      { get: false }
    );
    rpc.mockResolvedValueOnce(ok({ payment_id: other, fulfillment_status: "fulfilled" }));
    await expect(activateStaffPaidPayment(api, id, reason)).rejects.toMatchObject({ status: 503 });
  });

  it("declines a waiting refund with a reason", async () => {
    const { rpc, api } = fixture({ request_id: id, status: "declined", repeated: false });
    await expect(declineStaffPaymentRefund(api, id, "Wrong reference typed")).resolves.toEqual({
      request_id: id,
      status: "declined",
      repeated: false,
    });
    expect(rpc).toHaveBeenCalledWith(
      "decline_staff_payment_refund",
      { p_request_id: id, p_reason: "Wrong reference typed" },
      { get: false }
    );
  });
});
