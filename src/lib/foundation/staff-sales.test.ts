import { describe, expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { checkoutDropOffPercent, readStaffSalesSummary } from "./staff-sales";
import { FoundationStaffCommandError } from "./staff-command";

vi.mock("server-only", () => ({}));

function salesReply(change: Record<string, unknown> = {}) {
  return {
    vat: {
      payments: 5,
      net_cents: 42900,
      vat_status: "not_registered",
      alert_cents: 180000000,
      compulsory_cents: 230000000,
      alert: false,
    },
    products: [
      { category: "individual", term_days: 30, payments: 2, net_cents: 20700 },
      { category: "add_on", term_days: null, payments: 1, net_cents: 1500 },
    ],
    checkouts: {
      days: 30 as const,
      started: 8,
      paid: 4,
      failed: 1,
      cancelled: 1,
      expired: 1,
      open: 1,
    },
    ...change,
  };
}

function api(answer: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async () => answer);
  return { rpc, api: { rpc } as unknown as FoundationAuthenticatedApi };
}

describe("staff sales summary", () => {
  it("reads the database's figures with one staff command", async () => {
    const { rpc, api: client } = api({ data: salesReply(), error: null });
    const summary = await readStaffSalesSummary(client);
    expect(rpc).toHaveBeenCalledWith("get_staff_sales_summary", {}, { get: false });
    expect(summary.vat.net_cents).toBe(42900);
    expect(summary.products).toHaveLength(2);
  });

  it("refuses an answer with fields it does not know", async () => {
    const { api: client } = api({ data: salesReply({ owner_id: "x" }), error: null });
    await expect(readStaffSalesSummary(client)).rejects.toBeInstanceOf(FoundationStaffCommandError);
  });

  it("sends staff to verify again when the authenticator check expired", async () => {
    const { api: client } = api({
      data: null,
      error: { code: "42501", message: "recent second-factor verification required" },
    });
    await expect(readStaffSalesSummary(client)).rejects.toMatchObject({ mfaRequired: true });
  });

  it("works out the checkout drop-off in whole percent", () => {
    const checkouts = salesReply().checkouts;
    expect(checkoutDropOffPercent(checkouts)).toBe(50);
    expect(checkoutDropOffPercent({ ...checkouts, started: 3, paid: 2 })).toBe(33);
    expect(checkoutDropOffPercent({ ...checkouts, started: 0, paid: 0 })).toBeNull();
  });
});
