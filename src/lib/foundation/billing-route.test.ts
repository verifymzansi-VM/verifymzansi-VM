/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { checkRateLimit } from "../utils/rate-limit";
import { readFoundationBillingCatalogue } from "./billing-catalogue";
import { handleFoundationBillingRoute } from "./billing-route";
import {
  FoundationBillingError,
  FoundationPendingPaymentError,
  startFoundationCheckout,
  startFoundationSlotCheckout,
} from "./billing-runtime";
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
  startFoundationSlotCheckout: vi.fn(),
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
      code: "individual_30d",
      label: "Individual slot — 30 days",
      area: null,
      price_cents: "6900",
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
/** One 30-day Individual slot, as the checkout page sends it. */
const order = { planId, slots: 1, expectedTotalCents: 6900, coolingOffConsent: true };
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
  vi.mocked(startFoundationSlotCheckout).mockResolvedValue({
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
  it("start the slot checkout while add-on sales are paused", async () => {
    const response = await handleFoundationBillingRoute(request(order), "checkout");
    expect(response.status).toBe(200);
    expect(startFoundationSlotCheckout).toHaveBeenCalledExactlyOnceWith(
      {},
      account,
      { planId, slots: 1, expectedTotalCents: 6900, coolingOffConsent: true },
      "https://verifymzansi.com"
    );
    expect(startFoundationCheckout).not.toHaveBeenCalled();
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
    ["no number of slots", { planId, expectedTotalCents: 6900, coolingOffConsent: true }],
    ["no total", { planId, slots: 1, coolingOffConsent: true }],
    ["no slots at all", { ...order, slots: 0 }],
    ["more slots than one order holds", { ...order, slots: 26, expectedTotalCents: 6900 * 26 }],
    ["a fractional slot", { ...order, slots: 1.5 }],
  ])("refuse %s before any checkout", async (_label, value) => {
    const response = await handleFoundationBillingRoute(request(value), "checkout");
    expect(response.status).toBe(400);
    expect(startFoundationCheckout).not.toHaveBeenCalled();
    expect(startFoundationSlotCheckout).not.toHaveBeenCalled();
  });
  it.each([
    ["without the cooling-off consent", { ...order, coolingOffConsent: false }],
    ["with no answer to the consent", { planId, slots: 1, expectedTotalCents: 6900 }],
  ])("refuse a slot %s, saying why", async (_label, value) => {
    expect(await json(await handleFoundationBillingRoute(request(value), "checkout"))).toEqual({
      status: 400,
      body: {
        error: "Tick the box to confirm that your slot starts now.",
        code: "CONSENT_REQUIRED",
      },
    });
    expect(startFoundationSlotCheckout).not.toHaveBeenCalled();
  });
  it("passes the database's refusal through with its code", async () => {
    vi.mocked(startFoundationSlotCheckout).mockRejectedValueOnce(
      new FoundationBillingError(
        403,
        "Your ID review must be accepted first.",
        "ID_REVIEW_REQUIRED"
      )
    );
    expect(await json(await handleFoundationBillingRoute(request(order), "checkout"))).toEqual({
      status: 403,
      body: { error: "Your ID review must be accepted first.", code: "ID_REVIEW_REQUIRED" },
    });
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
  vi.mocked(startFoundationSlotCheckout).mockRejectedValueOnce(
    new FoundationBillingError(409, "Check this payment's status before starting another checkout")
  );
  const response = await handleFoundationBillingRoute(request(order), "checkout");
  expect(await json(response)).toEqual({
    status: 409,
    body: { error: "Check this payment's status before starting another checkout" },
  });
});

// The restored checkout page (src/app/billing/checkout/checkout-confirm.tsx)
// shows Continue, Check status and Cancel from this reply (PAY-12, M3.1).
it("answers an open plan payment with the restored page's pending payment reply", async () => {
  const pendingPayment = {
    id: uuid(5),
    checkoutUrl: "https://one.ozow.com/checkout/synthetic",
    statusUrl: `https://verifymzansi.com/billing/success?payment=${uuid(5)}`,
    canCancel: true,
  };
  vi.mocked(startFoundationSlotCheckout).mockRejectedValueOnce(
    new FoundationPendingPaymentError(pendingPayment)
  );
  const response = await handleFoundationBillingRoute(request(order), "checkout");
  expect(await json(response)).toEqual({
    status: 409,
    body: {
      error:
        "You already have a pending payment for this area. Continue the payment or cancel it before choosing another plan.",
      code: "PENDING_PAYMENT_EXISTS",
      pendingPayment,
    },
  });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});

// /api/billing/change-plan and /api/billing/cancel send production here
// (operation "retired"): plans are prepaid and never change or renew.
describe("the retired plan-change and cancel routes", () => {
  it("answer 410 with the retired code for a signed-in member", async () => {
    const response = await handleFoundationBillingRoute(request({ planId }), "retired");
    expect(await json(response)).toEqual({
      status: 410,
      body: {
        error:
          "Plans are prepaid for a fixed period and do not renew automatically. Buy another slot from Billing when you need it.",
        code: "LEGACY_PLAN_ROUTE_RETIRED",
      },
    });
    expect(startFoundationCheckout).not.toHaveBeenCalled();
  });
  it("still require the CSRF token before answering", async () => {
    const forged = new NextRequest("https://verifymzansi.com/api/billing/change-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://verifymzansi.com" },
      body: JSON.stringify({ planId }),
    });
    const response = await handleFoundationBillingRoute(forged, "retired");
    expect(response.status).toBe(403);
    expect(createFoundationRouteContext).not.toHaveBeenCalled();
  });
  it("are rate limited like other billing changes", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ limited: true, retryAfter: 30 } as never);
    const response = await handleFoundationBillingRoute(request({ planId }), "retired");
    expect(response.status).toBe(429);
    expect(vi.mocked(checkRateLimit).mock.calls[0]?.[0]).toMatchObject({
      action: "billing:checkout",
    });
  });
});

describe("failed billing requests are logged by reason code", () => {
  const spies = { error: vi.fn(), warn: vi.fn() };
  const logged = (level: "error" | "warn") =>
    spies[level].mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.includes("Billing request"));
  beforeEach(() => {
    spies.error = vi.spyOn(console, "error").mockImplementation(() => undefined) as never;
    spies.warn = vi.spyOn(console, "warn").mockImplementation(() => undefined) as never;
  });

  it("logs an outage with the operation and the kind of failure only", async () => {
    vi.mocked(startFoundationSlotCheckout).mockRejectedValue(
      Object.assign(new Error("PRIVATE_PROVIDER_DETAIL"), { name: "OzowProviderError" })
    );
    const result = await json(await handleFoundationBillingRoute(request(order), "checkout"));
    expect(result).toEqual({
      status: 503,
      body: { error: "Billing is temporarily unavailable" },
    });
    const [line] = logged("error");
    expect(line).toContain("Billing request failed");
    expect(line).toContain('"operation":"checkout"');
    expect(line).toContain('"reason":"provider_unavailable"');
    expect(line).not.toContain("PRIVATE");
    expect(line).not.toContain(account);
  });

  it("logs a refused request with its code, and leaves the member's reply as it was", async () => {
    vi.mocked(startFoundationSlotCheckout).mockRejectedValue(
      new FoundationPendingPaymentError({
        id: uuid(6),
        checkoutUrl: null,
        statusUrl: "https://verifymzansi.com/billing/success",
        canCancel: true,
      })
    );
    const result = await json(await handleFoundationBillingRoute(request(order), "checkout"));
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("PENDING_PAYMENT_EXISTS");
    const [line] = logged("warn");
    expect(line).toContain("Billing request refused");
    expect(line).toContain('"reason":"PENDING_PAYMENT_EXISTS"');
  });

  it("logs nothing for a request the member can fix", async () => {
    vi.mocked(startFoundationSlotCheckout).mockRejectedValue(new FoundationBillingError(400));
    expect((await handleFoundationBillingRoute(request(order), "checkout")).status).toBe(400);
    expect([...logged("error"), ...logged("warn")]).toEqual([]);
  });
});
