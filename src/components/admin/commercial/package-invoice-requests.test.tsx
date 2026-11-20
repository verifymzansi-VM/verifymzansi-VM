import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PackageInvoiceRequestPanel,
  type StaffPackageInvoiceRequestRow,
} from "./package-invoice-requests";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("@/lib/utils/csrf", () => ({ withCsrfHeaders: (headers: unknown) => headers }));

const row: StaffPackageInvoiceRequestRow = {
  request_id: "44444444-4444-4444-8444-444444444444",
  status: "requested",
  term_days: 90,
  slots: 25,
  total_cents: 750000,
  requested_at: "2026-11-19T08:00:00.000+00:00",
  customer_email: "dealer@example.test",
  customer_name: "Thandi D.",
  identity_accepted: true,
  package_open: false,
  needs_approval: false,
  due_days: null,
  prepared_by_me: false,
  prepared_by_name: null,
};
let fetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ data: { status: "issued", invoice_number: "VM-2026-000003" } }),
  }));
  vi.stubGlobal("fetch", fetch);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const panel = (rows: StaffPackageInvoiceRequestRow[], canIssue = true, canApprove = true) =>
  render(
    <PackageInvoiceRequestPanel
      canIssue={canIssue}
      canApprove={canApprove}
      requests={rows}
      approvalAboveCents={5_000_000}
    />
  );

describe("PackageInvoiceRequestPanel (P4e)", () => {
  it("shows nothing while no request is open", () => {
    const { container } = panel([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("issues the invoice of a request with the days to pay and a reason", async () => {
    panel([row]);
    expect(screen.getByText(/25 slots × 90 days/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Issue invoice" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Asked at checkout" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Issue invoice" }).at(-1)!);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = fetch.mock.calls[0] as [string, { body: string }];
    expect(url).toBe("/api/admin/commercial");
    expect(JSON.parse(init.body)).toEqual({
      action: "package_invoice.issue",
      requestId: row.request_id,
      dueDays: 7,
      reason: "Asked at checkout",
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Invoice VM-2026-000003 issued.");
  });

  it("above R50 000 prepares it, and only another admin approves it", () => {
    const { rerender } = panel([{ ...row, total_cents: 6_000_000, needs_approval: true }]);
    expect(screen.getByRole("button", { name: "Prepare invoice" })).toBeInTheDocument();
    const waiting = {
      ...row,
      status: "awaiting_approval" as const,
      total_cents: 6_000_000,
      needs_approval: true,
      due_days: 14,
      prepared_by_me: true,
      prepared_by_name: "Sipho F.",
    };
    rerender(
      <PackageInvoiceRequestPanel
        canIssue
        canApprove
        requests={[waiting]}
        approvalAboveCents={5_000_000}
      />
    );
    expect(screen.queryByRole("button", { name: "Approve and issue" })).toBeNull();
    rerender(
      <PackageInvoiceRequestPanel
        canIssue
        canApprove
        requests={[{ ...waiting, prepared_by_me: false }]}
        approvalAboveCents={5_000_000}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve and issue" }));
    expect(fetch).toHaveBeenCalledWith(
      "/api/admin/commercial",
      expect.objectContaining({
        body: JSON.stringify({ action: "package_invoice.approve", requestId: row.request_id }),
      })
    );
  });

  it("says why no invoice can be issued, and staff without the role only read", () => {
    panel([{ ...row, identity_accepted: false }], false, false);
    expect(screen.getByText(/ID review is not accepted/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows an added-slots request with the priced days, the package end and the days left now (P4b)", () => {
    const add = {
      ...row,
      slots: 20,
      total_cents: 253_340,
      package_open: true,
      kind: "add" as const,
      days_left: 38,
      days_left_now: 30,
      package_ends_at: "2026-12-24T08:00:00.000+00:00",
    };
    const { unmount } = panel([add]);
    expect(screen.getByText(/Add 20 slots · priced for 38 days/)).toBeInTheDocument();
    expect(screen.getByTestId("package-add-days")).toHaveTextContent(
      /Package ends .*2026.* · 30 whole days left now · issued now, the invoice is for 30 days at their lower price/
    );
    expect(screen.queryByText(/decline this request/)).toBeNull();
    unmount();
    panel([
      { ...add, days_left_now: 9 },
      {
        ...add,
        request_id: "55555555-5555-4555-8555-555555555555",
        days_left_now: null,
        package_open: false,
      },
    ]);
    expect(
      screen.getByText(/Fewer than 10 days of the customer's package are left/)
    ).toBeInTheDocument();
    expect(screen.getByText(/package has ended: decline this request/)).toBeInTheDocument();
  });

  it("issues an added-slots invoice with the due date the database sets, no days to choose (P4b)", async () => {
    panel([
      {
        ...row,
        slots: 2,
        total_cents: 25_334,
        package_open: true,
        kind: "add" as const,
        days_left: 38,
        days_left_now: 38,
        package_ends_at: "2099-12-24T08:00:00.000+00:00",
      },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Issue invoice" }));
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.getByTestId("package-add-due")).toHaveTextContent(
      /^Due .* \(3 days after it is issued, or the package's last day if sooner\)$/
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Asked on the add page" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Issue invoice" }).at(-1)!);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [, init] = fetch.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body)).toMatchObject({ action: "package_invoice.issue", dueDays: 3 });
  });
});
