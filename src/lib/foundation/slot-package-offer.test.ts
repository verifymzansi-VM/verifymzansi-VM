/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { readFoundationSlotPackageOffer, readPackagesOnSale } from "./slot-package-offer";
import type { FoundationServiceApi } from "./service-api";

vi.mock("server-only", () => ({}));
vi.mock("./service-api", () => ({ createFoundationServiceApi: vi.fn() }));

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const offer = {
  on_sale: true,
  min_slots: 5,
  max_online_slots: 100,
  max_slots: 250,
  online_limit_cents: "1000000",
  posts_per_slot_per_30_days: 4,
  plans: [
    { id: uuid(1), term_days: 30, price_cents_per_slot: "10000", label: "30 days" },
    { id: uuid(2), term_days: 90, price_cents_per_slot: "30000", label: "90 days" },
    { id: uuid(3), term_days: 180, price_cents_per_slot: "60000", label: "180 days" },
  ],
};
const api = (answer: { data: unknown; error: unknown }) =>
  ({ rpc: vi.fn(async () => answer) }) as unknown as FoundationServiceApi;

describe("the package offer (P4a)", () => {
  it("reads the offer from the public command", async () => {
    const client = api({ data: offer, error: null });
    expect(await readFoundationSlotPackageOffer(client)).toEqual(offer);
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith("get_slot_package_offer");
  });
  it("is on sale only when the switch is on and terms are listed", async () => {
    expect(await readPackagesOnSale(api({ data: offer, error: null }))).toEqual(offer);
    expect(
      await readPackagesOnSale(api({ data: { ...offer, on_sale: false, plans: [] }, error: null }))
    ).toBeNull();
    expect(
      await readPackagesOnSale(api({ data: { ...offer, plans: [] }, error: null }))
    ).toBeNull();
  });
  it("treats an outage or an unexpected answer as off", async () => {
    expect(await readPackagesOnSale(api({ data: null, error: { code: "PGRST" } }))).toBeNull();
    expect(
      await readPackagesOnSale(api({ data: { ...offer, plans: [{ term_days: 60 }] }, error: null }))
    ).toBeNull();
    await expect(
      readFoundationSlotPackageOffer(api({ data: { ...offer, extra: 1 }, error: null }))
    ).rejects.toThrow("Invalid foundation package offer");
  });
});
