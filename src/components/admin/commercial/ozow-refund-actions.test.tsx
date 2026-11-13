import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentsPanel, type AdminPaymentRow } from "./partners-panel";
import { OzowRefundAttention, type OzowRefundRow } from "./ozow-refund-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("@/lib/utils/csrf", () => ({ withCsrfHeaders: (headers: unknown) => headers }));

const account = "11111111-1111-4111-8111-111111111111";
const payment: AdminPaymentRow = {
  id: "22222222-2222-4222-8222-222222222222",
  user_id: account,
  area: "all",
  amount_cents: 6900,
  status: "complete",
  created_at: "2026-11-13T08:00:00Z",
  description: "Individual slot, 30 days",
  fulfillment_status: "fulfilled",
  merchant_reference: "abc123",
  activated_at: null,
  lines: [],
  refund_request: null,
};
const record = (overrides: Partial<OzowRefundRow> = {}): OzowRefundRow => ({
  id: "44444444-4444-4444-8444-444444444444",
  payment_id: payment.id,
  line_id: null,
  channel: "api",
  status: "sent",
  amount_cents: 6900,
  reason_code: "duplicate",
  requested_at: "2026-11-13T08:30:00Z",
  sent_at: "2026-11-13T08:30:00Z",
  failure_reason: null,
  ozow_refund_id: null,
  ozow_status: null,
  send_attempts: 1,
  ozow_missing_at: null,
  requested_by_me: false,
  ...overrides,
});

let fetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { status: "sent", answered: true } }),
  });
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true)
  );
  vi.stubGlobal(
    "prompt",
    vi.fn(() => "Ozow has no such refund")
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const sent = () => JSON.parse(fetch.mock.calls[0][1].body);

describe("refunds through Ozow", () => {
  it("keeps today's reference form while switched off", () => {
    render(<PaymentsPanel canRefund payments={[payment]} />);
    expect(screen.getByRole("button", { name: "Record refund" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refund through Ozow" })).toBeNull();
  });

  it("sends a refund through Ozow without asking for a reference", async () => {
    render(
      <PaymentsPanel
        canRefund
        payments={[payment]}
        ozow={{ refundable: [payment.id], records: [] }}
      />
    );
    expect(screen.queryByRole("button", { name: "Record refund" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refund through Ozow" }));
    const form = screen.getByRole("form", { name: /Refund through Ozow of/ });
    expect(within(form).queryByText(/reference/i)).toBeNull();
    fireEvent.change(within(form).getByRole("combobox"), { target: { value: "duplicate" } });
    fireEvent.change(within(form).getByPlaceholderText("Why is this change being made?"), {
      target: { value: "Paid twice by mistake" },
    });
    fireEvent.submit(form);
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(fetch.mock.calls[0][0]).toBe("/api/admin/payments/ozow-refunds");
    expect(sent()).toEqual({
      action: "refund.request",
      paymentId: payment.id,
      lineId: null,
      reasonCode: "duplicate",
      reason: "Paid twice by mistake",
    });
  });

  it("records a dashboard refund with Ozow's refund id", async () => {
    render(
      <PaymentsPanel
        canRefund
        payments={[payment]}
        ozow={{ refundable: [payment.id], records: [] }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Recorded in the Ozow dashboard" }));
    const form = screen.getByRole("form", { name: /Ozow dashboard refund of/ });
    fireEvent.change(within(form).getByRole("combobox"), { target: { value: "billing_error" } });
    fireEvent.change(within(form).getByPlaceholderText("The refund's id in the Ozow dashboard"), {
      target: { value: "b1fa5055-19c5-41ab-86dd-15272d103455" },
    });
    fireEvent.change(within(form).getByPlaceholderText("Why is this change being made?"), {
      target: { value: "Refunded by hand in Ozow" },
    });
    fireEvent.submit(form);
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(sent()).toMatchObject({
      action: "refund.dashboard",
      ozowRefundId: "b1fa5055-19c5-41ab-86dd-15272d103455",
    });
  });

  it("offers no refund while one is on its way through Ozow, and shows its state", () => {
    render(
      <PaymentsPanel
        canRefund
        payments={[payment]}
        ozow={{ refundable: [payment.id], records: [record()] }}
      />
    );
    expect(screen.queryByRole("button", { name: "Refund through Ozow" })).toBeNull();
    expect(screen.getByText("sent to Ozow")).toBeInTheDocument();
  });

  it("lets another staff member close an approved refund that was never sent", async () => {
    render(
      <OzowRefundAttention
        records={[
          record({ status: "approved", sent_at: null, send_attempts: 0 }),
          record({
            id: "55555555-5555-4555-8555-555555555555",
            status: "failed",
            failure_reason: "ozow_failed",
          }),
        ]}
      />
    );
    expect(screen.getByText("Refunds that need staff (2)")).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: "Close: never reached Ozow" });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(sent()).toEqual({
      action: "refund.close",
      requestId: "44444444-4444-4444-8444-444444444444",
      reason: "Ozow has no such refund",
    });
  });
});
