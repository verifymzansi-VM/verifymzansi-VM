import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readFoundationServerSession: vi.fn(),
  readFoundationPayment: vi.fn(),
  readFoundationMySlotPackage: vi.fn(),
  readFoundationMySlots: vi.fn(),
  readFoundationPackageAddOffer: vi.fn(),
  readPackagesOnSale: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/foundation/server-session", () => ({
  readFoundationServerSession: mocks.readFoundationServerSession,
}));
vi.mock("@/lib/foundation/billing-runtime", () => ({
  readFoundationPayment: mocks.readFoundationPayment,
  readFoundationMySlotPackage: mocks.readFoundationMySlotPackage,
  readFoundationMySlots: mocks.readFoundationMySlots,
  readFoundationPackageAddOffer: mocks.readFoundationPackageAddOffer,
}));
vi.mock("@/lib/foundation/slot-package-offer", () => ({
  readPackagesOnSale: mocks.readPackagesOnSale,
}));

import { readPackageConfirmation } from "./package-confirmation";

const PAYMENT_ID = "550e8400-e29b-41d4-a716-446655440000";
const PACKAGE_PLAN = "5b0f4c1e-2a7d-4c43-9b51-7e0d3f6a9c11";
const payment = (extra: Record<string, unknown> = {}) => ({
  id: PAYMENT_ID,
  product_id: PACKAGE_PLAN,
  status: "complete",
  fulfillment_status: "fulfilled",
  amount_cents: "100000",
  ...extra,
});
const held = {
  state: "active",
  places: 10,
  starts_at: "2026-11-19T08:00:00.000Z",
  ends_at: "2026-12-19T08:00:00.000Z",
  new_posts_limit: 40,
};

describe("readPackageConfirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readPackagesOnSale.mockResolvedValue({ plans: [{ id: PACKAGE_PLAN, term_days: 30 }] });
    mocks.readFoundationServerSession.mockResolvedValue({ api: {} });
    mocks.readFoundationPayment.mockResolvedValue(payment());
    mocks.readFoundationMySlotPackage.mockResolvedValue({ package: held });
    mocks.readFoundationMySlots.mockResolvedValue({ individual: { held: 2 } });
    mocks.readFoundationPackageAddOffer.mockResolvedValue({ package: { adds: [] } });
  });

  it("says how many slots an add payment added (P4b), and leaves it out when unreadable", async () => {
    mocks.readFoundationPackageAddOffer.mockResolvedValue({
      package: { adds: [{ payment_id: PAYMENT_ID, slots: 5, paid_at: held.starts_at }] },
    });
    await expect(readPackageConfirmation(PAYMENT_ID)).resolves.toMatchObject({
      details: { slots: 10, addedSlots: 5 },
    });
    mocks.readFoundationPackageAddOffer.mockRejectedValue(new Error("unavailable"));
    const result = await readPackageConfirmation(PAYMENT_ID);
    expect(result.packagePayment).toBe(true);
    expect(result.details).not.toHaveProperty("addedSlots");
  });

  it("reads the package a delivered package payment opened", async () => {
    await expect(readPackageConfirmation(PAYMENT_ID)).resolves.toEqual({
      packagePayment: true,
      details: {
        slots: 10,
        startsAt: held.starts_at,
        endsAt: held.ends_at,
        newPostsLimit: 40,
        paidCents: 100000,
        individualSlots: true,
      },
    });
  });

  it("knows a package payment that is not delivered yet, without details", async () => {
    mocks.readFoundationPayment.mockResolvedValue(payment({ status: "pending" }));
    await expect(readPackageConfirmation(PAYMENT_ID)).resolves.toEqual({
      packagePayment: true,
      details: null,
    });
    expect(mocks.readFoundationMySlotPackage).not.toHaveBeenCalled();
  });

  it("leaves every other payment, and packages off sale, with the general page", async () => {
    mocks.readFoundationPayment.mockResolvedValue(payment({ product_id: "another-plan" }));
    await expect(readPackageConfirmation(PAYMENT_ID)).resolves.toEqual({
      packagePayment: false,
      details: null,
    });
    mocks.readPackagesOnSale.mockResolvedValue(null);
    await expect(readPackageConfirmation(PAYMENT_ID)).resolves.toMatchObject({
      packagePayment: false,
    });
    await expect(readPackageConfirmation("not-a-payment")).resolves.toMatchObject({
      packagePayment: false,
    });
  });

  it("falls back to the general page when a read fails, and leaves out the Individual note without slots", async () => {
    mocks.readFoundationMySlots.mockRejectedValue(new Error("unavailable"));
    await expect(readPackageConfirmation(PAYMENT_ID)).resolves.toMatchObject({
      details: { individualSlots: false },
    });
    mocks.readFoundationMySlotPackage.mockRejectedValue(new Error("unavailable"));
    await expect(readPackageConfirmation(PAYMENT_ID)).resolves.toEqual({
      packagePayment: false,
      details: null,
    });
  });
});
