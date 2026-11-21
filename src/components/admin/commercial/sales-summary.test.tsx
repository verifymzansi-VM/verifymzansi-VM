import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StaffSalesSummary } from "@/lib/foundation/staff-sales";
import { SalesSummary } from "./sales-summary";

vi.mock("server-only", () => ({}));

const summary = (vat: Partial<StaffSalesSummary["vat"]> = {}): StaffSalesSummary => ({
  generated_at: "2026-11-21T09:03:05.123456+00:00",
  vat: {
    since: "2025-11-21T09:03:05.123456+00:00",
    payments: 5,
    net_cents: 42900,
    vat_status: "not_registered",
    alert_cents: 180000000,
    compulsory_cents: 230000000,
    alert: false,
    ...vat,
  },
  products: [
    { category: "individual", term_days: 30, payments: 2, net_cents: 20700 },
    { category: "add_on", term_days: null, payments: 1, net_cents: 1500 },
  ],
  checkouts: { days: 30, started: 8, paid: 4, failed: 1, cancelled: 1, expired: 1, open: 1 },
});

describe("Sales and VAT on the staff payments page", () => {
  it("shows the 12-month total, the VAT status, the checkout drop-off and sales by product", () => {
    render(<SalesSummary summary={summary()} />);
    expect(screen.getByRole("heading", { name: "Sales and VAT" })).toBeInTheDocument();
    expect(screen.getByText("Last 12 months").nextElementSibling).toHaveTextContent("R 429.00");
    expect(screen.getByText("5 payments")).toBeInTheDocument();
    expect(screen.getByText("Not registered")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("4 of 8 online checkouts paid")).toBeInTheDocument();
    expect(
      screen.getByText(/Not paid: 1 failed · 1 cancelled · 1 expired · 1 still open/)
    ).toBeInTheDocument();
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows[1]).toHaveTextContent(/Individual slot\s*30 days\s*2\s*R 207.00/);
    expect(rows[2]).toHaveTextContent(/^Add-on\s*1\s*R 15.00$/);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("raises the VAT alert at R1.8 million", () => {
    render(<SalesSummary summary={summary({ net_cents: 180000000, alert: true })} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      /VAT alert: sales passed R 1 800 000.00 .* compulsory from R 2 300 000.00/
    );
  });

  it("says when no checkout started and nothing was sold", () => {
    render(
      <SalesSummary
        summary={{
          ...summary({ net_cents: 0, payments: 0 }),
          products: [],
          checkouts: {
            days: 30,
            started: 0,
            paid: 0,
            failed: 0,
            cancelled: 0,
            expired: 0,
            open: 0,
          },
        }}
      />
    );
    expect(screen.getByText("None started")).toBeInTheDocument();
    expect(screen.getByText("No sales in the last 12 months.")).toBeInTheDocument();
    expect(screen.queryByText(/Not paid:/)).not.toBeInTheDocument();
  });

  it("never shows figures it could not read", () => {
    render(<SalesSummary summary={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Sales figures could not be loaded.");
    expect(screen.queryByText("Last 12 months")).not.toBeInTheDocument();
  });
});
