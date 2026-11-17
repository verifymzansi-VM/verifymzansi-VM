import { afterEach, describe, expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import {
  confirmStaffBankTransfer,
  declineStaffBankTransfer,
  normaliseBankReference,
  readStaffBankTransfersWaiting,
  readStaffBankTransferCustomer,
  readStaffBankTransfers,
  recordStaffBankTransfer,
  type StaffBankTransferInput,
} from "./staff-payments";

vi.mock("server-only", () => ({}));

const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const ok = (data: unknown) => ({ data, error: null });
const refused = (code: string, details?: string, message = "refused") => ({
  data: null,
  error: { code, details, message },
});
const fixture = (data: unknown) => {
  const rpc = vi.fn().mockResolvedValue(ok(data));
  return { rpc, api: { rpc } as unknown as FoundationAuthenticatedApi };
};
const input: StaffBankTransferInput = {
  accountEmail: " thandi@example.test ",
  termDays: 180,
  slots: 2,
  amountCents: 82800,
  bankReference: "  FNB   2026-11  A1 ",
  clearedOn: "2026-11-13",
  coolingOffWaiver: true,
  reason: "EFT cleared; written waiver on file",
};
const record = {
  transfer_id: other,
  status: "awaiting_confirmation",
  account_id: id,
  customer_email: "thandi@example.test",
  similar_records: 0,
  customer_name: "Thandi D.",
  term_days: 180,
  slots: 2,
  amount_received_cents: 82800,
  bank_reference: "FNB 2026-11 A1",
  cleared_on: "2026-11-13",
  reason: "EFT cleared; written waiver on file",
  recorded_at: "2026-11-13T10:00:00.000+00:00",
  recorded_by_me: true,
  recorded_by_name: "Sipho F.",
  payment_id: null,
};
const recorded = { ...record, repeated: false };
afterEach(() => vi.resetAllMocks());

describe("bank transfer adapters", () => {
  it("normalises a bank reference as the database does", () => {
    expect(normaliseBankReference("  FNB   2026-11  A1 ")).toBe("FNB 2026-11 A1");
    expect(normaliseBankReference("A-1")).toBeNull();
    expect(normaliseBankReference("R--1--2")).toBeNull();
    expect(normaliseBankReference("REF;DROP")).toBeNull();
    expect(normaliseBankReference("X".repeat(61))).toBeNull();
  });

  it("records a cleared transfer with the normalised reference", async () => {
    const { rpc, api } = fixture(recorded);
    await expect(recordStaffBankTransfer(api, input)).resolves.toMatchObject({
      transfer_id: other,
      status: "awaiting_confirmation",
      payment_id: null,
      repeated: false,
    });
    expect(rpc).toHaveBeenCalledWith(
      "record_staff_invoice_payment",
      {
        p_account_email: "thandi@example.test",
        p_term_days: 180,
        p_slots: 2,
        p_amount_cents: 82800,
        p_bank_reference: "FNB 2026-11 A1",
        p_cleared_on: "2026-11-13",
        p_cooling_off_waiver: true,
        p_reason: "EFT cleared; written waiver on file",
      },
      { get: false }
    );
  });

  it("refuses before any database call without a reference, the waiver or above R50 000", async () => {
    const { rpc, api } = fixture(recorded);
    await expect(
      recordStaffBankTransfer(api, { ...input, bankReference: "  " })
    ).rejects.toMatchObject({
      status: 422,
      message: "Enter the bank reference from the bank statement.",
    });
    await expect(
      recordStaffBankTransfer(api, { ...input, bankReference: "A-1" })
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      recordStaffBankTransfer(api, { ...input, coolingOffWaiver: false })
    ).rejects.toMatchObject({
      status: 422,
      message: "Confirm the customer agreed in writing to the cooling-off waiver.",
    });
    await expect(
      recordStaffBankTransfer(api, { ...input, amountCents: 5_000_001 })
    ).rejects.toMatchObject({ status: 422 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("explains the database's refusals in staff words", async () => {
    const { rpc, api } = fixture({});
    const cases: [ReturnType<typeof refused>, number, string][] = [
      [
        refused("PT409", "bank_reference_used"),
        409,
        "A bank transfer with that reference, amount and date is already waiting or confirmed. Check the payments list before recording it.",
      ],
      [
        refused("PT404", "invoice_account_unavailable"),
        404,
        "No confirmed account has that email.",
      ],
      [
        refused("PT412", "invoice_buyer_unverified"),
        409,
        "The customer's ID review must be accepted before their slots are recorded.",
      ],
      [
        refused("PT428", "invoice_amount_mismatch"),
        422,
        "The amount received is not the order total. Check the term and the number of slots.",
      ],
      [
        refused("PT429", "slot_limit_reached"),
        409,
        "The person would hold more slots than their limit. Raise the limit or refund.",
      ],
      [
        refused("42501", "staff_same_identity"),
        403,
        "Another staff member must handle a payment of your own.",
      ],
    ];
    for (const [reply, status, message] of cases) {
      rpc.mockResolvedValueOnce(reply);
      await expect(recordStaffBankTransfer(api, input)).rejects.toMatchObject({ status, message });
    }
  });

  it("reads whose account an email names, and refuses a customer the staff member referred", async () => {
    const preview = {
      customer_name: "Thandi D.",
      id_reviewed: true,
      can_use_slots: true,
      slots_held: 1,
      slot_limit: 4,
    };
    const { rpc, api } = fixture(preview);
    await expect(readStaffBankTransferCustomer(api, " thandi@example.test ")).resolves.toEqual(
      preview
    );
    expect(rpc).toHaveBeenCalledWith(
      "get_staff_invoice_customer",
      { p_account_email: "thandi@example.test" },
      { get: false }
    );
    rpc.mockResolvedValueOnce(refused("42501", "staff_referred_customer"));
    await expect(readStaffBankTransferCustomer(api, "x@example.test")).rejects.toMatchObject({
      status: 403,
      message:
        "Another staff member must handle a payment of a customer you or its recorder referred.",
    });
  });

  it("confirms or declines a waiting record, and lists the waiting ones", async () => {
    const { rpc, api } = fixture({
      ...record,
      status: "confirmed",
      recorded_by_me: false,
      payment_id: id,
      commissions: 2,
      slots_started: 2,
      ends_at: "2027-05-12T10:00:00.000+00:00",
      repeated: false,
    });
    await expect(confirmStaffBankTransfer(api, other)).resolves.toMatchObject({
      status: "confirmed",
      payment_id: id,
    });
    expect(rpc).toHaveBeenCalledWith(
      "confirm_staff_invoice_payment",
      { p_transfer_id: other },
      { get: false }
    );
    rpc.mockResolvedValueOnce(refused("42501", "transfer_confirmer_same"));
    await expect(confirmStaffBankTransfer(api, other)).rejects.toMatchObject({
      status: 403,
      message: "Another staff member must confirm this bank transfer: you recorded it.",
    });
    rpc.mockResolvedValueOnce(refused("PT409", "transfer_not_waiting"));
    await expect(confirmStaffBankTransfer(api, other)).rejects.toMatchObject({ status: 409 });
    rpc.mockResolvedValueOnce(ok({ ...record, status: "declined", repeated: false }));
    await expect(
      declineStaffBankTransfer(api, other, "The bank shows no such transfer")
    ).resolves.toMatchObject({ status: "declined" });
    expect(rpc).toHaveBeenLastCalledWith(
      "decline_staff_invoice_payment",
      { p_transfer_id: other, p_reason: "The bank shows no such transfer" },
      { get: false }
    );
    rpc.mockResolvedValueOnce(ok({ waiting: 1, items: [record] }));
    await expect(readStaffBankTransfersWaiting(api)).resolves.toEqual({
      waiting: 1,
      items: [record],
    });
  });

  it("refuses an unexpected reply", async () => {
    const { api } = fixture({ ...recorded, extra: 1 });
    await expect(recordStaffBankTransfer(api, input)).rejects.toMatchObject({ status: 503 });
  });

  it("reads the transfer details of listed payments only, without a call for none", async () => {
    const transfer = {
      payment_id: id,
      bank_reference: "FNB 2026-11 A1",
      cleared_on: "2026-11-13",
      amount_received_cents: 82800,
      recorded_at: "2026-11-13T10:00:00.000+00:00",
      recorded_by_me: true,
      confirmed_by_me: false,
      reason: "EFT cleared; written waiver on file",
    };
    const { rpc, api } = fixture({ items: [transfer, { ...transfer, payment_id: other }] });
    await expect(readStaffBankTransfers(api, [])).resolves.toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
    await expect(readStaffBankTransfers(api, [id, id])).resolves.toEqual([transfer]);
    expect(rpc).toHaveBeenCalledWith(
      "get_staff_invoice_payments",
      { p_payment_ids: [id] },
      { get: false }
    );
  });
});
