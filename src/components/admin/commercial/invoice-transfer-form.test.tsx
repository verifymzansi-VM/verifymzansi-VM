import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvoiceTransferForm } from "./invoice-transfer-form";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("@/lib/utils/csrf", () => ({ withCsrfHeaders: (headers: unknown) => headers }));

let fetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ data: { status: "awaiting_confirmation", repeated: false } }),
  }));
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("record a bank transfer to an invoice", () => {
  it("sends the invoice number, reference, date, waiver and reason", async () => {
    render(<InvoiceTransferForm invoiceNumber="VM-2026-000001" />);
    fireEvent.click(screen.getByRole("button", { name: "Record a bank transfer" }));
    const form = screen.getByRole("form", { name: "Record a bank transfer to this invoice" });
    fireEvent.change(within(form).getByLabelText("Bank reference"), {
      target: { value: "FNB 2026-11 A1" },
    });
    fireEvent.change(within(form).getByLabelText("Date it cleared"), {
      target: { value: "2026-11-14" },
    });
    fireEvent.click(within(form).getByRole("checkbox"));
    fireEvent.change(within(form).getByLabelText("Reason (audited)"), {
      target: { value: "EFT cleared on the statement" },
    });
    fireEvent.submit(form);
    expect(await screen.findByText(/waits for another staff member/)).toBeInTheDocument();
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      action: "invoice.record_transfer",
      invoiceNumber: "VM-2026-000001",
      bankReference: "FNB 2026-11 A1",
      clearedOn: "2026-11-14",
      coolingOffWaiver: true,
      reason: "EFT cleared on the statement",
    });
  });
});
