import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BankTransferPanel, randToCents } from "./bank-transfer-form";
import { PaymentsPanel, type AdminPaymentRow } from "./partners-panel";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("@/lib/utils/csrf", () => ({ withCsrfHeaders: (headers: unknown) => headers }));

let fetch: ReturnType<typeof vi.fn>;
let confirm: ReturnType<typeof vi.fn>;
let customer: Record<string, unknown>;
let recorded: Record<string, unknown>;
beforeEach(() => {
  customer = {
    customer_name: "Thandi D.",
    id_reviewed: true,
    can_use_slots: true,
    slots_held: 1,
    slot_limit: 4,
  };
  recorded = { payment_id: "p", repeated: false };
  fetch = vi.fn(async (_url: string, init: { body: string }) => {
    const action = JSON.parse(init.body).action;
    return {
      ok: true,
      json: async () => ({
        data: action === "payment.transfer_customer" ? customer : recorded,
      }),
    };
  });
  confirm = vi.fn(() => true);
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("confirm", confirm);
  vi.stubGlobal("alert", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const sent = (call = 0) => JSON.parse(fetch.mock.calls[call][1].body);

describe("randToCents", () => {
  it.each([
    ["1656", 165600],
    ["1656.5", 165650],
    ["R1 656,00", 165600],
    ["1,656.00", 165600],
    ["69", 6900],
  ])("reads %s", (value, cents) => expect(randToCents(value)).toBe(cents));
  it.each(["", "abc", "1.234", "-5"])("refuses %s", (value) =>
    expect(randToCents(value)).toBeNull()
  );
});

describe("record a bank transfer", () => {
  const fill = (form: HTMLElement) => {
    fireEvent.change(within(form).getByLabelText("Customer's account email"), {
      target: { value: "thandi@example.test" },
    });
    fireEvent.change(within(form).getByLabelText("Slot term"), { target: { value: "180" } });
    fireEvent.change(within(form).getByLabelText("Number of slots"), { target: { value: "2" } });
    fireEvent.change(within(form).getByLabelText("Bank reference"), {
      target: { value: "FNB 2026-11 A1" },
    });
    fireEvent.change(within(form).getByLabelText("Reason (audited)"), {
      target: { value: "EFT cleared; written waiver on file" },
    });
  };

  it("shows the order total, flags a different amount and sends the transfer", async () => {
    render(<BankTransferPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Record a bank transfer" }));
    const form = screen.getByRole("form", { name: "Record a bank transfer" });
    fill(form);
    expect(within(form).getByText("Order total: R828")).toBeInTheDocument();
    const amount = within(form).getByLabelText("Amount received (R)");
    fireEvent.change(amount, { target: { value: "800" } });
    expect(within(form).getByText(/Not the order total/)).toBeInTheDocument();
    fireEvent.change(amount, { target: { value: "828.00" } });
    expect(within(form).queryByText(/Not the order total/)).toBeNull();
    const waiver = within(form).getByRole("checkbox");
    expect(waiver).toBeRequired();
    fireEvent.click(waiver);
    fireEvent.submit(form);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(sent(0)).toEqual({
      action: "payment.transfer_customer",
      accountEmail: "thandi@example.test",
    });
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining(
        "Record R828 from Thandi D. (thandi@example.test) for 2 × 180-day slots? They hold 1 of 4 slots."
      )
    );
    expect(sent(1)).toEqual({
      action: "payment.record_transfer",
      accountEmail: "thandi@example.test",
      termDays: 180,
      slots: 2,
      amountCents: 82800,
      bankReference: "FNB 2026-11 A1",
      clearedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      coolingOffWaiver: true,
      reason: "EFT cleared; written waiver on file",
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Bank transfer recorded");
  });

  it("sends nothing when staff cancel the confirmation", async () => {
    confirm.mockReturnValue(false);
    render(<BankTransferPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Record a bank transfer" }));
    const form = screen.getByRole("form", { name: "Record a bank transfer" });
    fill(form);
    fireEvent.change(within(form).getByLabelText("Amount received (R)"), {
      target: { value: "828" },
    });
    fireEvent.submit(form);
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sent(0).action).toBe("payment.transfer_customer");
  });

  it("stops before recording when the customer's ID review is not accepted", async () => {
    customer = { ...customer, id_reviewed: false, slots_held: null, slot_limit: null };
    render(<BankTransferPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Record a bank transfer" }));
    const form = screen.getByRole("form", { name: "Record a bank transfer" });
    fill(form);
    fireEvent.change(within(form).getByLabelText("Amount received (R)"), {
      target: { value: "828" },
    });
    fireEvent.submit(form);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This customer's ID review is not accepted yet. Nothing was recorded."
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("says plainly when the same transfer was already recorded", async () => {
    recorded = { payment_id: "p", repeated: true };
    render(<BankTransferPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Record a bank transfer" }));
    const form = screen.getByRole("form", { name: "Record a bank transfer" });
    fill(form);
    fireEvent.change(within(form).getByLabelText("Amount received (R)"), {
      target: { value: "828" },
    });
    fireEvent.submit(form);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "already recorded with these details: nothing new was recorded"
    );
  });
});

describe("a payment recorded from a bank transfer", () => {
  const row: AdminPaymentRow = {
    id: "22222222-2222-4222-8222-222222222222",
    user_id: "11111111-1111-4111-8111-111111111111",
    area: "all",
    amount_cents: 6900,
    status: "complete",
    created_at: "2026-11-13T08:00:00Z",
    description: "Individual slot — 30 days",
    fulfillment_status: "fulfilled",
    merchant_reference: "abc123",
    activated_at: null,
    bank_transfer: { bank_reference: "FNB 2026-11 A1", cleared_on: "2026-11-13" },
    lines: [],
    refund_request: null,
  };

  it("shows the bank reference and asks for the reference of the transfer back", () => {
    render(<PaymentsPanel canRefund payments={[row]} />);
    expect(
      screen.getByText(/Bank transfer FNB 2026-11 A1, cleared 2026-11-13/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Ref abc123/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Record refund" }));
    const form = screen.getByRole("form", { name: "Refund of this payment" });
    expect(within(form).getByLabelText("Bank reference of the refund transfer")).toBeRequired();
  });
});
