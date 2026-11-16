/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { checkRateLimit } from "../utils/rate-limit";
import { readFoundationBillingCatalogue } from "./billing-catalogue";
import { handleFoundationBillingRoute } from "./billing-route";
import { FoundationBillingError, startFoundationPackageCheckout } from "./billing-runtime";
import type * as BillingRuntime from "./billing-runtime";
import { createFoundationRouteContext } from "./request-route";
import { readFoundationSlotPackageOffer } from "./slot-package-offer";

vi.mock("./runtime-connection", () => ({ readFoundationRuntimeConnection: vi.fn(() => ({})) }));
vi.mock("./request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("./public-api", () => ({ createFoundationPublicApi: vi.fn(() => ({})) }));
vi.mock("./service-api", () => ({ createFoundationServiceApi: vi.fn(() => ({})) }));
vi.mock("./billing-catalogue", () => ({ readFoundationBillingCatalogue: vi.fn() }));
vi.mock("./posting-allowance", () => ({ readPostingAllowance: vi.fn() }));
vi.mock("./slot-package-offer", () => ({ readFoundationSlotPackageOffer: vi.fn() }));
vi.mock("../utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: vi.fn(() => ({ key: "client" })),
}));
vi.mock("./billing-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof BillingRuntime>()),
  startFoundationPackageCheckout: vi.fn(),
}));

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const account = uuid(1);
const plan30 = uuid(2);
const plan90 = uuid(3);
const token = "c".repeat(64);
const offer = (onSale: boolean) => ({
  on_sale: onSale,
  min_slots: 5,
  max_online_slots: 100,
  max_slots: 250,
  online_limit_cents: "1000000",
  posts_per_slot_per_30_days: 4,
  plans: onSale
    ? [
        { id: plan30, term_days: 30, price_cents_per_slot: "10000", label: "30 days" },
        { id: plan90, term_days: 90, price_cents_per_slot: "30000", label: "90 days" },
      ]
    : [],
});
const request = (value: unknown) =>
  new NextRequest("https://verifymzansi.com/api/billing/package-checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://verifymzansi.com",
      Cookie: `vm_csrf=${token}`,
      "x-csrf-token": token,
    },
    body: JSON.stringify(value),
  });
const order = { planId: plan90, slots: 25, expectedTotalCents: 750000, coolingOffConsent: true };
const json = async (response: NextResponse) => ({
  status: response.status,
  body: await response.json(),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticateCaller: vi.fn(async () => ({ accountId: account, api: {} })),
    respond: vi.fn(async (response: NextResponse) => response),
  } as never);
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false } as never);
  vi.mocked(readFoundationSlotPackageOffer).mockResolvedValue(offer(true) as never);
  vi.mocked(startFoundationPackageCheckout).mockResolvedValue({
    paymentId: uuid(5),
    checkoutUrl: "https://one.ozow.com/checkout/synthetic",
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the Multi-listing package checkout (P4a)", () => {
  it("is refused while packages are not on sale, before any payment", async () => {
    vi.mocked(readFoundationSlotPackageOffer).mockResolvedValueOnce(offer(false) as never);
    expect(
      await json(await handleFoundationBillingRoute(request(order), "package-checkout"))
    ).toEqual({
      status: 403,
      body: { error: "Multi-listing packages are not on sale yet.", code: "PACKAGES_NOT_ON_SALE" },
    });
    expect(startFoundationPackageCheckout).not.toHaveBeenCalled();
    expect(readFoundationBillingCatalogue).not.toHaveBeenCalled();
  });
  it("starts the package checkout for the term on offer with the total shown", async () => {
    const response = await handleFoundationBillingRoute(request(order), "package-checkout");
    expect(await json(response)).toEqual({
      status: 200,
      body: {
        paymentId: uuid(5),
        checkoutUrl: "https://one.ozow.com/checkout/synthetic",
        account_id: account,
      },
    });
    expect(startFoundationPackageCheckout).toHaveBeenCalledExactlyOnceWith(
      {},
      account,
      { planId: plan90, slots: 25, expectedTotalCents: 750000, coolingOffConsent: true },
      "https://verifymzansi.com"
    );
  });
  it.each([
    ["fewer than 5 slots", { ...order, slots: 4, expectedTotalCents: 120000 }],
    ["more than 100 slots online", { ...order, slots: 101, expectedTotalCents: 3030000 }],
    ["a term that is not on offer", { ...order, planId: uuid(9) }],
    ["a total other than the price", { ...order, expectedTotalCents: 740000 }],
    ["no consent", { ...order, coolingOffConsent: false }],
    ["an unknown field", { ...order, area: "market" }],
  ])("refuses %s before any payment", async (_label, value) => {
    const response = await handleFoundationBillingRoute(request(value), "package-checkout");
    expect([400, 409]).toContain(response.status);
    expect(startFoundationPackageCheckout).not.toHaveBeenCalled();
  });
  it("passes the database's refusal through with its code", async () => {
    vi.mocked(startFoundationPackageCheckout).mockRejectedValueOnce(
      new FoundationBillingError(
        409,
        "This account already has a Multi-listing package.",
        "PACKAGE_ACTIVE"
      )
    );
    expect(
      await json(await handleFoundationBillingRoute(request(order), "package-checkout"))
    ).toEqual({
      status: 409,
      body: { error: "This account already has a Multi-listing package.", code: "PACKAGE_ACTIVE" },
    });
  });
});
