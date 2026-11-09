/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { checkRateLimit } from "../utils/rate-limit";
import { readFoundationBillingCatalogue } from "./billing-catalogue";
import { handleFoundationBillingRoute } from "./billing-route";
import { FoundationBillingError, startFoundationCheckout } from "./billing-runtime";
import type * as BillingRuntime from "./billing-runtime";
import { createFoundationRouteContext } from "./request-route";

vi.mock("./runtime-connection", () => ({ readFoundationRuntimeConnection: vi.fn(() => ({})) }));
vi.mock("./request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("./public-api", () => ({ createFoundationPublicApi: vi.fn(() => ({})) }));
vi.mock("./billing-catalogue", () => ({ readFoundationBillingCatalogue: vi.fn() }));
vi.mock("./posting-allowance", () => ({ readPostingAllowance: vi.fn() }));
vi.mock("../utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: vi.fn(() => ({ key: "client" })),
}));
vi.mock("./billing-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof BillingRuntime>()),
  startFoundationCheckout: vi.fn(),
}));

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const account = uuid(1);
const planId = uuid(2);
const addonId = uuid(3);
const postId = uuid(4);
const token = "c".repeat(64);
const paused = {
  error: "Add-ons open soon. You have not been charged.",
  code: "addon_sales_paused",
};
const catalogue = {
  plans: [
    {
      id: planId,
      code: "business_30d",
      label: "Business 30 days",
      area: "business",
      price_cents: "5000",
      currency: "ZAR",
      duration_days: 30,
      slot_capacity: 1,
      max_photos: 10,
      max_videos: 1,
      addon_capabilities: ["urgent"],
    },
  ],
  addons: [{ id: addonId, kind: "urgent", days: 7, price_cents: "1000", currency: "ZAR" }],
};
const request = (value?: unknown) =>
  new NextRequest("https://verifymzansi.com/api/billing/create-checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://verifymzansi.com",
      Cookie: `vm_csrf=${token}`,
      "x-csrf-token": token,
    },
    body: value === undefined ? undefined : JSON.stringify(value),
  });
const addon = { postId, kind: "urgent" as const, days: 7 };
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
  vi.mocked(readFoundationBillingCatalogue).mockResolvedValue(catalogue as never);
  vi.mocked(startFoundationCheckout).mockResolvedValue({
    paymentId: uuid(5),
    checkoutUrl: "https://one.ozow.com/checkout/synthetic",
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("add-on checkouts while paid add-on sales are paused (the default)", () => {
  it("refuses before the session, rate limit, catalogue or checkout", async () => {
    expect(await json(await handleFoundationBillingRoute(request({}), "checkout", addon))).toEqual({
      status: 403,
      body: paused,
    });
    expect(createFoundationRouteContext).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(readFoundationBillingCatalogue).not.toHaveBeenCalled();
    expect(startFoundationCheckout).not.toHaveBeenCalled();
  });
  it.each(["boost", "featured", "urgent"] as const)("refuses %s", async (kind) => {
    const response = await handleFoundationBillingRoute(request({}), "checkout", {
      ...addon,
      kind,
    });
    expect(await json(response)).toEqual({ status: 403, body: paused });
    expect(startFoundationCheckout).not.toHaveBeenCalled();
  });
});

describe("plan checkouts are not add-ons", () => {
  it("still start exactly as before while add-on sales are paused", async () => {
    const response = await handleFoundationBillingRoute(request({ planId }), "checkout");
    expect(response.status).toBe(200);
    expect(startFoundationCheckout).toHaveBeenCalledExactlyOnceWith(
      {},
      account,
      planId,
      null,
      "https://verifymzansi.com"
    );
  });
  it.each([
    ["an add-on product as the plan", { planId: addonId }],
    ["an upper-case add-on product", { planId: addonId.toUpperCase() }],
    ["a list of plans", { planId: [planId] }],
    ["a list holding the add-on", { planId: [addonId] }],
    ["a target post", { planId, post_id: postId }],
    ["a provider target post", { planId, p_target_post: postId }],
    ["a stored target post", { planId, target_post_id: postId }],
    ["an add-on kind", { planId, kind: "urgent" }],
    ["an add-on kind list", { planId, kind: ["urgent", "boost"] }],
    ["an add-on object", { planId, addon: { kind: "urgent", days: 7 } }],
    ["an add-on product id", { planId, product_id: addonId }],
    ["a renamed plan field", { PlanId: planId }],
    ["an upper-case plan field", { PLANID: planId }],
    ["the plan field twice with another case", { planId, planID: addonId }],
    ["a body list", [{ planId }]],
  ])("refuse %s before any checkout", async (_label, value) => {
    const response = await handleFoundationBillingRoute(request(value), "checkout");
    expect(response.status).toBe(400);
    expect(startFoundationCheckout).not.toHaveBeenCalled();
  });
});

describe("once paid add-on sales are switched on", () => {
  beforeEach(() => vi.stubEnv("ADDON_SALES_ENABLED", "true"));
  it("starts the add-on checkout for the catalogue product and the post", async () => {
    const response = await handleFoundationBillingRoute(request({}), "checkout", addon);
    expect(response.status).toBe(200);
    expect(startFoundationCheckout).toHaveBeenCalledExactlyOnceWith(
      {},
      account,
      addonId,
      postId,
      "https://verifymzansi.com"
    );
  });
});

it("passes the paused code through when a deeper check refuses", async () => {
  vi.stubEnv("ADDON_SALES_ENABLED", "true");
  vi.mocked(startFoundationCheckout).mockRejectedValueOnce(
    new FoundationBillingError(403, paused.error, paused.code)
  );
  const response = await handleFoundationBillingRoute(request({}), "checkout", addon);
  expect(await json(response)).toEqual({ status: 403, body: paused });
});
it("keeps other billing errors without a code", async () => {
  vi.mocked(startFoundationCheckout).mockRejectedValueOnce(
    new FoundationBillingError(409, "Check this payment's status before starting another checkout")
  );
  const response = await handleFoundationBillingRoute(request({ planId }), "checkout");
  expect(await json(response)).toEqual({
    status: 409,
    body: { error: "Check this payment's status before starting another checkout" },
  });
});
