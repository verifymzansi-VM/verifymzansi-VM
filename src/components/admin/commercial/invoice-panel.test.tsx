import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvoicePanel, type StaffInvoiceRow } from "./invoice-panel";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("@/lib/utils/csrf", () => ({ withCsrfHeaders: (headers: unknown) => headers }));

const row: StaffInvoiceRow = {
  invoice_id: "11111111-1111-4111-8111-111111111111",
  invoice_number: "VM-2026-000001",
  status: "issued",
  customer_email: "thandi@example.test",
  customer_name: "Thandi D.",
  description: "3 × Individual slot — 90 days",
  total_cents: 62100,
  issued_at: "2026-11-14T08:00:00.000+00:00",
  due_on: "2026-11-21",
  issued_by_me: true,
  latest_attempt: null,
};
let fetch: ReturnType<typeof vi.fn>;
let customer: Record<string, unknown>;
beforeEach(() => {
  customer = {
    customer_name: "Thandi D.",
    id_reviewed: true,
    can_use_slots: true,
    slots_held: 0,
    slot_limit: 4,
  };
  fetch = vi.fn(async (_url: string, init: { body: string }) => {
    const action = JSON.parse(init.body).action;
    return {
      ok: true,
      json: async () => ({
        data:
          action === "payment.transfer_customer"
            ? customer
            : { invoice_number: "VM-2026-000002", repeated: false },
      }),
    };
  });
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true)
  );
  vi.stubGlobal(
    "prompt",
    vi.fn(() => "Issued for the wrong term")
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const sent = (call: number) => JSON.parse(fetch.mock.calls[call][1].body);

describe("staff invoices", () => {
  it("checks whose account the email names, then issues with a request id", async () => {
    render(<InvoicePanel canIssue invoices={[]} unpaid={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Issue an invoice" }));
    const form = screen.getByRole("form", { name: "Issue an invoice" });
    fireEvent.change(within(form).getByLabelText("Customer's account email"), {
      target: { value: "thandi@example.test" },
    });
    fireEvent.change(within(form).getByLabelText("Slot term"), { target: { value: "90" } });
    fireEvent.change(within(form).getByLabelText("Number of slots"), { target: { value: "3" } });
    fireEvent.change(within(form).getByLabelText("Reason (audited)"), {
      target: { value: "Invoice requested by email" },
    });
    expect(within(form).getByText("Invoice total: R621")).toBeInTheDocument();
    fireEvent.submit(form);
    expect(await screen.findByText(/Invoice VM-2026-000002 issued/)).toBeInTheDocument();
    expect(sent(0)).toEqual({
      action: "payment.transfer_customer",
      accountEmail: "thandi@example.test",
    });
    expect(sent(1)).toMatchObject({
      action: "invoice.issue",
      accountEmail: "thandi@example.test",
      termDays: 90,
      slots: 3,
      dueDays: 7,
      reason: "Invoice requested by email",
    });
    expect(sent(1).requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("issues nothing for a customer whose ID review is not accepted", async () => {
    customer.id_reviewed = false;
    render(<InvoicePanel canIssue invoices={[]} unpaid={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Issue an invoice" }));
    const form = screen.getByRole("form", { name: "Issue an invoice" });
    fireEvent.change(within(form).getByLabelText("Customer's account email"), {
      target: { value: "thandi@example.test" },
    });
    fireEvent.submit(form);
    expect(await screen.findByRole("alert")).toHaveTextContent("ID review is not accepted");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("lists the latest invoices and voids an unpaid one with a reason", async () => {
    render(
      <InvoicePanel
        canIssue
        invoices={[
          row,
          { ...row, invoice_id: "2", invoice_number: "VM-2026-000002", status: "paid" },
        ]}
        unpaid={1}
      />
    );
    expect(screen.getByText("Latest invoices · 1 unpaid")).toBeInTheDocument();
    const voidButtons = screen.getAllByRole("button", { name: "Void" });
    expect(voidButtons).toHaveLength(1);
    fireEvent.click(voidButtons[0]);
    await waitFor(() =>
      expect(sent(0)).toEqual({
        action: "invoice.void",
        invoiceId: row.invoice_id,
        reason: "Issued for the wrong term",
      })
    );
  });

  it("shows no issue or void controls without the refund capability", () => {
    render(<InvoicePanel canIssue={false} invoices={[row]} unpaid={1} />);
    expect(screen.queryByRole("button", { name: "Issue an invoice" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Void" })).toBeNull();
    expect(screen.getByRole("link", { name: "VM-2026-000001" })).toHaveAttribute(
      "href",
      "/admin/payments/invoices/VM-2026-000001"
    );
  });
});
