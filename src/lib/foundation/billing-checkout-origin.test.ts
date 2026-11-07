/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { parse } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import type { FoundationServiceApi } from "./service-api";
import { createOzowHostedPayment, isMockOzowEnabled } from "../payments/ozow";
import { startFoundationCheckout } from "./billing-runtime";

// The checkout address guard (roadmap M0.8). With production settings only
// https://verifymzansi.com is accepted, exactly as before. Another address is
// accepted only for the local test copy, when every condition holds.

vi.mock("server-only", () => ({}));
vi.mock("../config/env", () => ({ env: (name: string) => process.env[name] }));
vi.mock("../payments/ozow", () => ({
  cancelOzowPaymentRequest: vi.fn(),
  createOzowHostedPayment: vi.fn(),
  getOzowPaymentRequestStatus: vi.fn(),
  isMockOzowEnabled: vi.fn(),
  listOzowPaymentTransactions: vi.fn(),
}));

type Env = Record<string, string | undefined>;
const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const owner = uuid(1),
  product = uuid(2),
  payment = uuid(3),
  requestId = uuid(4),
  claim = uuid(6),
  idempotency = uuid(7),
  correlation = uuid(8);
const OZOW_URL = "https://one.ozow.com/checkout/synthetic";
const MOCK_URL = `https://127.0.0.1:55455/checkout?paymentId=${payment}&amount=50.00`;
const COPY_ORIGIN = "http://127.0.0.1:3110";

const COPY: Env = {
  NODE_ENV: "production",
  ENVIRONMENT: "test",
  VERIFYMZANSI_RUNTIME_MODE: "e2e",
  PLAYWRIGHT_TEST_MODE: "1",
  ENABLE_MOCK_OZOW: "true",
  OZOW_ENV: "staging",
  NEXT_PUBLIC_DATA_BACKEND: "foundation",
  FOUNDATION_PROJECT_REF: "local-foundation",
  FOUNDATION_SUPABASE_URL: "http://127.0.0.1:55443",
  NEXT_PUBLIC_APP_URL: COPY_ORIGIN,
};
/** The production Worker's committed settings plus its Ozow mode (a secret). */
function productionEnv(): Env {
  const toml = parse(readFileSync("wrangler.toml", "utf8")) as {
    env: { production: { vars: Env } };
  };
  return { ...toml.env.production.vars, OZOW_ENV: "production" };
}

const rpc = vi.fn(),
  machine = vi.fn();
const api = { rpc } as unknown as FoundationAuthenticatedApi;
const service = { rpc: machine } as unknown as FoundationServiceApi;
let storedCheckoutUrl: string | null = null;
let providerUrl = OZOW_URL;

function stubEnv(values: Env) {
  vi.unstubAllEnvs();
  vi.stubGlobal("window", undefined);
  vi.stubGlobal("document", undefined);
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}
const start = (appUrl: string) =>
  startFoundationCheckout(api, owner, product, null, appUrl, service);

beforeEach(() => {
  vi.clearAllMocks();
  storedCheckoutUrl = null;
  providerUrl = OZOW_URL;
  vi.mocked(isMockOzowEnabled).mockReturnValue(true);
  rpc.mockImplementation(async () => ({
    data: {
      payment_id: payment,
      merchant_reference: "a".repeat(32),
      amount_cents: "5000",
      currency: "ZAR",
      status: "pending",
    },
    error: null,
  }));
  machine.mockImplementation(async (name: string) => ({
    data:
      name === "claim_checkout_request"
        ? {
            id: payment,
            owner_id: owner,
            product_kind: "plan",
            product_id: product,
            target_post_id: null,
            amount_cents: "5000",
            currency: "ZAR",
            status: "pending",
            fulfillment_status: "unfulfilled",
            merchant_reference: "a".repeat(32),
            provider_request_id: storedCheckoutUrl ? requestId : null,
            provider_transaction_id: null,
            checkout_url: storedCheckoutUrl,
            checkout_expires_at: "2030-01-01T00:00:00Z",
            created_at: "2026-10-25T00:00:00Z",
            label: "Synthetic prepaid plan",
            claim_token: storedCheckoutUrl ? null : claim,
            idempotency_key: idempotency,
            correlation_id: correlation,
          }
        : true,
    error: null,
  }));
  vi.mocked(createOzowHostedPayment).mockImplementation(async () => ({
    providerPaymentId: requestId,
    providerReference: "a".repeat(32),
    redirectUrl: providerUrl,
    expireAt: "2030-01-01T00:00:00Z",
    correlationId: correlation,
    idempotencyKey: idempotency,
    rawResponse: {},
  }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function expectRefusedBeforeAnyCall(appUrl: string) {
  await expect(start(appUrl)).rejects.toMatchObject({ status: 503 });
  expect(rpc).not.toHaveBeenCalled();
  expect(machine).not.toHaveBeenCalled();
  expect(createOzowHostedPayment).not.toHaveBeenCalled();
}
async function expectRedirectRefused() {
  await expect(start(COPY_ORIGIN)).rejects.toMatchObject({ status: 503 });
  expect(machine.mock.calls.some(([name]) => name === "complete_checkout_request")).toBe(false);
}
const attachedUrl = () =>
  machine.mock.calls.find(([name]) => name === "complete_checkout_request")?.[1]?.p_checkout_url;

/** Addresses production must refuse (and the copy too, apart from its own). */
const OTHER_ADDRESSES = [
  "http://verifymzansi.com",
  "https://verifymzansi.com:8443",
  "https://verifymzansi.com:80",
  "https://www.verifymzansi.com",
  "https://staging.verifymzansi.com",
  "https://pay.verifymzansi.com",
  "https://verifymzansi.co.za",
  "https://verifymzansi.com.",
  "https://VERIFYMZANSI.COM.",
  "https://verifymzansi.com.evil.example",
  "https://evilverifymzansi.com",
  "https://verifymzansi.com@evil.example",
  "https://VERIFYMZANSI.COM@evil.example",
  "https://user@verifymzansi.com",
  "https://user:pass@verifymzansi.com",
  "https://:pass@verifymzansi.com",
  "https://evil.example/https://verifymzansi.com",
  "https://evil.example/?next=https://verifymzansi.com",
  "https://evil.example#https://verifymzansi.com",
  "https://evil.example\\@verifymzansi.com",
  "http://127.0.0.1:3110",
  "http://localhost:3110",
  "http://[::1]:3110",
  "http://0x7f000001:3110",
  "https://127.0.0.1",
  "https://[::ffff:127.0.0.1]",
  "file:///verifymzansi.com",
  "data:text/plain,https://verifymzansi.com",
];

describe("with production settings", () => {
  beforeEach(() => stubEnv(productionEnv()));

  it("accepts https://verifymzansi.com and sends the provider only its return addresses", async () => {
    expect(await start("https://verifymzansi.com")).toEqual({
      paymentId: payment,
      checkoutUrl: OZOW_URL,
    });
    expect(createOzowHostedPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        returnUrl: `https://verifymzansi.com/billing/success?payment=${payment}`,
        cancelUrl: `https://verifymzansi.com/billing/cancel?payment=${payment}`,
      })
    );
  });

  for (const address of OTHER_ADDRESSES)
    it(`refuses ${address} before any database or provider call`, () =>
      expectRefusedBeforeAnyCall(address));

  it("refuses a malformed address as before (URL error, no call)", async () => {
    await expect(start("verifymzansi.com")).rejects.toBeInstanceOf(TypeError);
    expect(rpc).not.toHaveBeenCalled();
  });

  // The guard compares origins, as before: these are the same origin, and the
  // provider still only ever receives https://verifymzansi.com addresses.
  for (const spelling of [
    "https://VerifyMzansi.com",
    "HTTPS://VERIFYMZANSI.COM",
    "https://verifymzansi.com:443",
    "https://verifymzansi.com/",
    "https://verifymzansi.com/billing?x=1#y",
  ])
    it(`treats ${spelling} as the same origin, returning only to https://verifymzansi.com`, async () => {
      await start(spelling);
      expect(vi.mocked(createOzowHostedPayment).mock.calls[0][0].returnUrl).toBe(
        `https://verifymzansi.com/billing/success?payment=${payment}`
      );
    });

  it("refuses the test copy's mock payment page from the provider, without attaching it", async () => {
    providerUrl = MOCK_URL;
    await expect(start("https://verifymzansi.com")).rejects.toMatchObject({ status: 503 });
    expect(machine.mock.calls.some(([name]) => name === "complete_checkout_request")).toBe(false);
  });

  it("refuses a stored mock payment page", async () => {
    storedCheckoutUrl = MOCK_URL;
    await expect(start("https://verifymzansi.com")).rejects.toMatchObject({ status: 503 });
    expect(createOzowHostedPayment).not.toHaveBeenCalled();
  });

  it("refuses the test copy's address even if every test switch leaked in", async () => {
    stubEnv({
      ...productionEnv(),
      VERIFYMZANSI_RUNTIME_MODE: "e2e",
      PLAYWRIGHT_TEST_MODE: "1",
      ENABLE_MOCK_OZOW: "true",
      OZOW_ENV: "staging",
    });
    await expectRefusedBeforeAnyCall(COPY_ORIGIN);
  });
});

describe("in the local test copy", () => {
  beforeEach(() => stubEnv(COPY));

  it("accepts the copy's own address and attaches the mock payment page", async () => {
    providerUrl = MOCK_URL;
    expect(await start(COPY_ORIGIN)).toEqual({ paymentId: payment, checkoutUrl: MOCK_URL });
    expect(createOzowHostedPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        returnUrl: `${COPY_ORIGIN}/billing/success?payment=${payment}`,
        cancelUrl: `${COPY_ORIGIN}/billing/cancel?payment=${payment}`,
      })
    );
    expect(attachedUrl()).toBe(MOCK_URL);
  });

  it("returns a stored mock payment page without another provider call", async () => {
    storedCheckoutUrl = MOCK_URL;
    expect(await start(COPY_ORIGIN)).toEqual({ paymentId: payment, checkoutUrl: MOCK_URL });
    expect(createOzowHostedPayment).not.toHaveBeenCalled();
  });

  it("still accepts the production address and Ozow pages, as before", async () => {
    expect(await start("https://verifymzansi.com")).toEqual({
      paymentId: payment,
      checkoutUrl: OZOW_URL,
    });
  });

  // 0x7f000001 is 127.0.0.1 written another way: the same origin as the copy.
  for (const address of OTHER_ADDRESSES.filter(
    (value) => new URL(value).origin !== COPY_ORIGIN
  ).concat([
    "http://127.0.0.1:3111",
    "https://127.0.0.1:3110",
    "http://user@127.0.0.1:3110",
    "http://127.0.0.1:3110@evil.example",
    "http://127.0.0.1.evil.example:3110",
  ]))
    it(`refuses ${address}`, () => expectRefusedBeforeAnyCall(address));

  for (const redirect of [
    "https://127.0.0.1:55456/checkout",
    "http://127.0.0.1:55455/checkout",
    "https://localhost:55455/checkout",
    "https://[::1]:55455/checkout",
    "https://user@127.0.0.1:55455/checkout",
    "https://:pass@127.0.0.1:55455/checkout",
    "https://127.0.0.1:55455@evil.example/checkout",
    "https://evil.example/https://127.0.0.1:55455/checkout",
    "http://127.0.0.1:3110/api/mock-ozow",
  ])
    it(`refuses the provider page ${redirect}`, async () => {
      providerUrl = redirect;
      await expectRedirectRefused();
    });

  it("refuses the copy's address when the provider is not really the mock", async () => {
    vi.mocked(isMockOzowEnabled).mockReturnValue(false);
    await expectRefusedBeforeAnyCall(COPY_ORIGIN);
  });

  it("refuses the mock payment page when the provider is not really the mock", async () => {
    vi.mocked(isMockOzowEnabled).mockReturnValue(false);
    providerUrl = MOCK_URL;
    await expect(start("https://verifymzansi.com")).rejects.toMatchObject({ status: 503 });
    expect(machine.mock.calls.some(([name]) => name === "complete_checkout_request")).toBe(false);
  });

  // Each condition flipped back to a production-like value refuses on its own.
  for (const [label, change] of [
    ["ENVIRONMENT=production", { ENVIRONMENT: "production" }],
    ["ENVIRONMENT missing", { ENVIRONMENT: undefined }],
    ["no e2e runtime", { VERIFYMZANSI_RUNTIME_MODE: undefined }],
    ["browser test mode missing", { PLAYWRIGHT_TEST_MODE: undefined }],
    ["mock Ozow missing", { ENABLE_MOCK_OZOW: undefined }],
    ["OZOW_ENV=production", { OZOW_ENV: "production" }],
    ["OZOW_ENV missing", { OZOW_ENV: undefined }],
    ["the retired backend", { NEXT_PUBLIC_DATA_BACKEND: "source" }],
    ["the London project ref", { FOUNDATION_PROJECT_REF: "gntzjtuncsyefujajmjy" }],
    [
      "the London database",
      { FOUNDATION_SUPABASE_URL: "https://gntzjtuncsyefujajmjy.supabase.co" },
    ],
    ["another local database", { FOUNDATION_SUPABASE_URL: "http://127.0.0.1:55441" }],
  ] as [string, Env][]) {
    it(`refuses the copy's address with ${label}`, async () => {
      stubEnv({ ...COPY, ...change });
      await expectRefusedBeforeAnyCall(COPY_ORIGIN);
    });
    it(`refuses the mock payment page with ${label}`, async () => {
      stubEnv({ ...COPY, ...change });
      providerUrl = MOCK_URL;
      await expect(start("https://verifymzansi.com")).rejects.toMatchObject({ status: 503 });
      expect(machine.mock.calls.some(([name]) => name === "complete_checkout_request")).toBe(false);
    });
  }
});
