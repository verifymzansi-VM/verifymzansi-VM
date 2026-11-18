import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentsPanel, type AdminPaymentRow } from "./partners-panel";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("@/lib/utils/csrf", () => ({ withCsrfHeaders: (headers: unknown) => headers }));

const account = "11111111-1111-4111-8111-111111111111";
const base: AdminPaymentRow = {
  id: "22222222-2222-4222-8222-222222222222",
  user_id: account,
  area: "all",
  amount_cents: 13800,
  status: "complete",
  created_at: "2026-11-13T08:00:00Z",
  description: "Individual slot — 30 days",
  fulfillment_status: "fulfilled",
  merchant_reference: "abc123",
  activated_at: null,
  lines: [],
  refund_request: null,
};
const line = (n: number, status = "open") => ({
  id: `3333333${n}-3333-4333-8333-333333333333`,
  line_number: n,
  amount_cents: 6900,
  status,
  reversal_kind: status === "reversed" ? "refunded" : null,
});

let fetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  // Five days after the payments below: inside Ozow's 13 days for a refund.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T08:00:00Z"));
  fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { ok: true } }) });
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true)
  );
  vi.stubGlobal(
    "prompt",
    vi.fn(() => "Paid after the checkout was cancelled")
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const sent = () => JSON.parse(fetch.mock.calls[0][1].body);

describe("staff payments panel", () => {
  it("marks a paid but undelivered payment and activates it with an audited reason", async () => {
    render(
      <PaymentsPanel
        canRefund
        payments={[{ ...base, fulfillment_status: "needs_reconciliation" }]}
      />
    );
    expect(screen.getByText("not delivered")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Activate what was paid for" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(sent()).toEqual({
      action: "payment.activate",
      paymentId: base.id,
      reason: "Paid after the checkout was cancelled",
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Activated: the member now has what they paid for"
    );
  });

  it("shows delivered payments without the activation button, and nothing to staff without refunds", () => {
    const { rerender } = render(<PaymentsPanel canRefund payments={[base]} />);
    expect(screen.getByText("delivered")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activate what was paid for" })).toBeNull();
    rerender(
      <PaymentsPanel
        canRefund={false}
        payments={[{ ...base, fulfillment_status: "needs_reconciliation" }]}
      />
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("records a refund only with Ozow's reference and a reason code", async () => {
    render(<PaymentsPanel canRefund payments={[base]} />);
    fireEvent.click(screen.getByRole("button", { name: "Record refund" }));
    const form = screen.getByRole("form", { name: "Refund of this payment" });
    const reference = within(form).getByLabelText("Ozow refund reference");
    expect(reference).toBeRequired();
    expect(within(form).getByLabelText("Reason")).toBeRequired();
    fireEvent.change(within(form).getByLabelText("Reason"), {
      target: { value: "s14_cancellation" },
    });
    fireEvent.change(reference, { target: { value: "OZ-REF-1" } });
    fireEvent.change(within(form).getByLabelText("Reason (audited)"), {
      target: { value: "Cancelled within the cooling-off period" },
    });
    fireEvent.submit(form);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(sent()).toEqual({
      action: "payment.reverse",
      paymentId: base.id,
      kind: "refunded",
      reasonCode: "s14_cancellation",
      ozowReference: "OZ-REF-1",
      reason: "Cancelled within the cooling-off period",
    });
  });

  it("says a refund or chargeback above R1 000 needs a second staff member", async () => {
    const approval = /Above R1 000 returned on this payment: another staff member must approve it/;
    const { rerender } = render(
      <PaymentsPanel canRefund payments={[{ ...base, amount_cents: 165600 }]} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Record refund" }));
    expect(screen.getByText(approval)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Record chargeback" }));
    expect(screen.getByText(approval)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // A slot that alone is small, after three slots were already returned.
    const big = (n: number, status = "open") => ({ ...line(n, status), amount_cents: 41400 });
    rerender(
      <PaymentsPanel
        canRefund
        payments={[
          {
            ...base,
            amount_cents: 165600,
            lines: [big(1, "reversed"), big(2, "reversed"), big(3), big(4)],
          },
        ]}
      />
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Refund this slot" })[0]);
    expect(screen.getByText(approval)).toBeInTheDocument();
  });

  it("refunds one slot of a multi-slot order", async () => {
    render(<PaymentsPanel canRefund payments={[{ ...base, lines: [line(1), line(2)] }]} />);
    const slots = screen.getByRole("list", { name: "Slots in this payment" });
    fireEvent.click(within(slots).getAllByRole("button", { name: "Refund this slot" })[1]);
    const form = screen.getByRole("form", { name: "Refund of slot 2" });
    fireEvent.change(within(form).getByLabelText("Reason"), { target: { value: "billing_error" } });
    fireEvent.change(within(form).getByLabelText("Ozow refund reference"), {
      target: { value: "OZ-SLOT-2" },
    });
    fireEvent.change(within(form).getByLabelText("Reason (audited)"), {
      target: { value: "Second slot bought by mistake" },
    });
    fireEvent.submit(form);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(sent()).toMatchObject({
      action: "payment.reverse_slot",
      lineId: line(2).id,
      reasonCode: "billing_error",
      ozowReference: "OZ-SLOT-2",
    });
  });

  it("hides whole-payment refunds once a slot was refunded", () => {
    render(
      <PaymentsPanel canRefund payments={[{ ...base, lines: [line(1, "reversed"), line(2)] }]} />
    );
    expect(screen.queryByRole("button", { name: "Record refund" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Refund this slot" })).toHaveLength(1);
  });

  it("offers 'Cancelled before the renewal started' only on a renewal, and names it on a record", () => {
    const offered = () => {
      const form = screen.getByRole("form", { name: "Refund of this payment" });
      return within(within(form).getByLabelText("Reason"))
        .getAllByRole("option")
        .map((option) => option.getAttribute("value"));
    };
    const five = [
      "",
      "billing_error",
      "duplicate",
      "our_failure_after_fix_offered",
      "s14_cancellation",
      "breach_credit",
    ];
    const first = render(<PaymentsPanel canRefund payments={[base]} />);
    fireEvent.click(screen.getByRole("button", { name: "Record refund" }));
    expect(offered()).toEqual(five);
    first.unmount();
    const renewal = { ...base, description: "Renewal: Individual slot — 30 days" };
    const { rerender } = render(<PaymentsPanel canRefund payments={[renewal]} />);
    fireEvent.click(screen.getByRole("button", { name: "Record refund" }));
    expect(offered()).toEqual([...five, "renewal_cancelled_before_start"]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // A refund recorded with the reason reads.
    rerender(
      <PaymentsPanel
        canRefund
        payments={[
          {
            ...base,
            refund_request: {
              id: "44444444-4444-4444-8444-444444444444",
              line_id: null,
              kind: "refunded",
              reason_code: "renewal_cancelled_before_start",
              amount_cents: 165600,
              ozow_reference: "OZ-BIG-1",
              requested_at: "2026-11-13T09:00:00Z",
              requested_by_me: false,
            },
          },
        ]}
      />
    );
    expect(screen.getByText(/Cancelled before the renewal started/)).toBeInTheDocument();
  });

  it("past Ozow's 13 days, a refund is paid back by bank transfer with the bank reference", async () => {
    // Paid 13 days ago (base is 5 days old): Ozow no longer refunds it.
    render(
      <PaymentsPanel
        canRefund
        payments={[{ ...base, created_at: "2026-11-05T08:00:00Z", lines: [line(1), line(2)] }]}
      />
    );
    expect(screen.queryByRole("button", { name: "Record refund" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Slot paid back by bank transfer" })).toHaveLength(
      2
    );
    fireEvent.click(screen.getByRole("button", { name: "Paid back by bank transfer" }));
    const form = screen.getByRole("form", { name: "Refund of the whole order" });
    expect(form).toHaveTextContent(
      "The 13 days for a refund through Ozow have passed: pay it back by bank transfer first, then record the bank reference."
    );
    fireEvent.change(within(form).getByLabelText("Reason"), {
      target: { value: "s14_cancellation" },
    });
    fireEvent.change(within(form).getByLabelText("Bank reference of the refund transfer"), {
      target: { value: "FNB refund 0001" },
    });
    fireEvent.change(within(form).getByLabelText("Reason (audited)"), {
      target: { value: "Cancelled within 14 days, paid back by EFT" },
    });
    fireEvent.submit(form);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(sent()).toMatchObject({
      action: "payment.reverse",
      kind: "refunded",
      ozowReference: "FNB refund 0001",
    });
  });

  it("past Ozow's 13 days, a chargeback keeps Ozow's reference", () => {
    render(
      <PaymentsPanel canRefund payments={[{ ...base, created_at: "2026-11-05T08:00:00Z" }]} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Record chargeback" }));
    const form = screen.getByRole("form", { name: "Chargeback of this payment" });
    expect(within(form).getByLabelText("Ozow chargeback reference")).toBeInTheDocument();
    expect(form).not.toHaveTextContent("pay it back by bank transfer");
  });

  it("lets another staff member approve a waiting refund, never its requester", async () => {
    const request = {
      id: "44444444-4444-4444-8444-444444444444",
      line_id: null,
      kind: "refunded" as const,
      reason_code: "our_failure_after_fix_offered" as const,
      amount_cents: 165600,
      ozow_reference: "OZ-BIG-1",
      requested_at: "2026-11-13T09:00:00Z",
      requested_by_me: true,
    };
    const { rerender } = render(
      <PaymentsPanel canRefund payments={[{ ...base, refund_request: request }]} />
    );
    expect(screen.getByText(/R1 656 waiting for approval/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve refund" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Record refund" })).toBeNull();
    rerender(
      <PaymentsPanel
        canRefund
        payments={[{ ...base, refund_request: { ...request, requested_by_me: false } }]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve refund" }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(sent()).toEqual({ action: "payment.refund_approve", requestId: request.id });
  });
});
