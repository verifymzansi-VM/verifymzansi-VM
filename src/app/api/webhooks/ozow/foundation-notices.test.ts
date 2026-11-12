/** @vitest-environment node */
// The three ways a payment is confirmed, on the foundation backend, with
// redacted sample Ozow messages (every value here is synthetic):
// - the signed notice: /api/webhooks/ozow;
// - the 10-minute status check: /api/internal/payments/reconcile;
// - the member's status page: /api/billing/payment-status.
// The real routes, payment runtime, Ozow client and confirmation checks run;
// only the database commands, the member's session and Ozow's API are stand-ins.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Webhook } from "svix";
import { resetOzowTokenCacheForTesting } from "@/lib/payments/ozow";
import { POST as notice } from "./route";
import { POST as reconcile } from "../../internal/payments/reconcile/route";
import { GET as paymentStatus } from "../../billing/payment-status/route";

const warn = vi.hoisted(() => vi.fn());
const error = vi.hoisted(() => vi.fn());
const machine = vi.hoisted(() => vi.fn());
const member = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/config/env", () => ({ env: (name: string) => process.env[name] }));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn, error }),
}));
vi.mock("@/lib/security/security-events", () => ({
  recordSecurityEvent: vi.fn(),
  securityContext: () => ({}),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ limited: false })),
  checkLocalRateLimit: vi.fn(() => ({ limited: false })),
  getClientIp: () => "192.0.2.1",
  getClientRateLimitIdentity: () => ({ key: "client" }),
}));
vi.mock("@/lib/foundation/service-api", () => ({
  createFoundationServiceApi: () => ({ rpc: machine }),
}));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: () => ({}),
}));
vi.mock("@/lib/foundation/request-route", () => ({
  createFoundationRouteContext: () => ({
    authenticateCaller: async () => ({ accountId: OWNER, api: { rpc: member } }),
    respond: async (response: Response) => response,
  }),
}));

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const OWNER = uuid(1);
const PAYMENT = uuid(3);
const REQUEST = uuid(4);
const TRANSACTION = uuid(5);
const REFERENCE = PAYMENT.replaceAll("-", "");
const SITE = "SYNTHETIC-SITE";
// Built at run time so no key-shaped literal sits in the repository.
const SIGNING_SECRET_SYNTHETIC = `whsec_${Buffer.from("m3-2-synthetic-signing-key-only!").toString("base64")}`;
const JOBS_SECRET_SYNTHETIC = "synthetic";

const storedPayment = (change: Record<string, unknown> = {}) => ({
  id: PAYMENT,
  owner_id: OWNER,
  product_kind: "plan",
  product_id: uuid(2),
  target_post_id: null,
  amount_cents: "5000",
  currency: "ZAR",
  status: "pending",
  fulfillment_status: "unfulfilled",
  merchant_reference: REFERENCE,
  provider_request_id: REQUEST,
  provider_transaction_id: null,
  checkout_url: null,
  checkout_expires_at: "2030-01-01T00:00:00Z",
  created_at: "2026-11-01T08:00:00Z",
  label: "Synthetic plan",
  ...change,
});

/** A redacted full notice, in the shape Ozow's full notices use. */
const fullNotice = (change: Record<string, unknown> = {}) => ({
  type: "transaction.complete",
  data: {
    TransactionId: TRANSACTION,
    TransactionReference: REFERENCE,
    SiteCode: SITE,
    IsTest: "False",
    Status: "Successful",
    Amount: "50.00",
    CurrencyCode: "ZAR",
    paymentRequestId: REQUEST,
    ...change,
  },
});
/** A redacted thin notice: only the transaction and a status. */
const thinNotice = (status = "Successful") => ({
  type: "transaction.complete",
  data: { id: TRANSACTION, status },
});
/** A redacted transaction as Ozow's lookup API returns it: the published
 * One API Transaction object, which has no test-mode flag and no request id. */
const apiTransaction = (change: Record<string, unknown> = {}) => ({
  links: { self: `https://one.ozow.com/v1/transactions/${TRANSACTION}` },
  id: TRANSACTION,
  amount: { currency: "ZAR", value: 50 },
  merchantReference: REFERENCE,
  siteCode: SITE,
  institution: "Synthetic Bank",
  status: "Successful",
  createdDate: "2026-11-01T08:01:00Z",
  completedDate: "2026-11-01T08:02:00Z",
  ...change,
});
/** Logged with this reason at warning or error level. */
const logged = (message: string, paymentId: string | null, reason: string) =>
  [...warn.mock.calls, ...error.mock.calls].some(
    ([text, fields]) =>
      text === message && JSON.stringify(fields) === JSON.stringify({ paymentId, reason })
  );

type HeaderStyle = "svix" | "webhook";
function signedNotice(
  body: unknown,
  { style = "svix" as HeaderStyle, at = new Date(), extra = {} as Record<string, string> } = {}
) {
  const raw = JSON.stringify(body);
  const id = "msg_synthetic_0001";
  return new NextRequest("https://verifymzansi.com/api/webhooks/ozow", {
    method: "POST",
    body: raw,
    headers: {
      "Content-Type": "application/json",
      [`${style}-id`]: id,
      [`${style}-timestamp`]: String(Math.floor(at.getTime() / 1000)),
      [`${style}-signature`]: new Webhook(SIGNING_SECRET_SYNTHETIC).sign(id, at, raw),
      ...extra,
    },
  });
}

/** Ozow's API stand-in: the token, one transaction, a request's transactions
 * and its status. Answers are set per test. */
let lookup: { transaction: unknown; transactions: unknown[]; request: string };
const ozow = vi.fn(async (input: RequestInfo | URL) => {
  const url = new URL(String(input));
  const json = (body: unknown) => Response.json(body);
  if (url.pathname === "/v1/token")
    return json({ access_token: "token-synthetic", expires_in: 600 });
  if (url.pathname === `/v1/transactions/${TRANSACTION}`) return json(lookup.transaction);
  if (url.pathname === `/v1/payments/${REQUEST}/transactions`)
    return json({ results: lookup.transactions, links: { next: null } });
  if (url.pathname === `/v1/payments/${REQUEST}`)
    return json({ id: REQUEST, status: lookup.request });
  return new Response("not found", { status: 404 });
});

/** The database commands. Unknown commands answer null, so a later command
 * added to these paths does not break the checks below. */
let stored: ReturnType<typeof storedPayment> | null;
const commands = () => machine.mock.calls.map(([name]) => name as string);
const settled = () => machine.mock.calls.filter(([name]) => name === "apply_provider_event");

beforeEach(() => {
  vi.clearAllMocks();
  resetOzowTokenCacheForTesting();
  vi.stubEnv("OZOW_ENV", "production");
  vi.stubEnv("OZOW_SITE_CODE", SITE);
  vi.stubEnv("OZOW_WEBHOOK_SECRET", SIGNING_SECRET_SYNTHETIC);
  vi.stubEnv("OZOW_CLIENT_ID", "client-id-synthetic");
  vi.stubEnv("OZOW_CLIENT_SECRET", "client-secret-synthetic");
  vi.stubEnv("OZOW_API_BASE_URL", "");
  vi.stubEnv("ENABLE_MOCK_OZOW", "");
  vi.stubEnv("INTERNAL_JOBS_SECRET", JOBS_SECRET_SYNTHETIC);
  vi.stubGlobal("fetch", ozow);
  stored = storedPayment();
  lookup = { transaction: apiTransaction(), transactions: [apiTransaction()], request: "Created" };
  machine.mockImplementation(database);
  member.mockImplementation(async () => ({ data: stored, error: null }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function database(name: string) {
  return Promise.resolve({
    data: ["get_checkout_payment", "claim_payment_reconciliation"].includes(name)
      ? stored
      : name === "list_reconcilable_payments"
        ? [storedPayment()]
        : name === "apply_provider_event"
          ? { outcome: "completed", payment_id: PAYMENT, fulfillment_status: "fulfilled" }
          : name === "expire_stale_checkouts"
            ? 0
            : null,
    error: null,
  });
}

const runReconcile = () =>
  reconcile(
    new Request("https://verifymzansi.com/api/internal/payments/reconcile", {
      method: "POST",
      headers: { authorization: `Bearer ${JOBS_SECRET_SYNTHETIC}` },
    })
  );
const readStatus = () =>
  paymentStatus(
    new NextRequest(`https://verifymzansi.com/api/billing/payment-status?payment=${PAYMENT}`)
  );

describe("the signed notice's headers", () => {
  it.each<HeaderStyle>(["svix", "webhook"])("verifies the %s-* header style", async (style) => {
    const response = await notice(signedNotice(fullNotice(), { style }));
    expect(response.status).toBe(200);
    expect(settled()).toHaveLength(1);
  });

  it("accepts both styles together when they carry the same values", async () => {
    const at = new Date();
    const signed = signedNotice(fullNotice(), { at });
    const extra = Object.fromEntries(
      ["id", "timestamp", "signature"].map((part) => [
        `webhook-${part}`,
        signed.headers.get(`svix-${part}`) as string,
      ])
    );
    const response = await notice(signedNotice(fullNotice(), { at, extra }));
    expect(response.status).toBe(200);
    expect(settled()).toHaveLength(1);
  });

  it.each(["id", "timestamp", "signature"])(
    "refuses a notice whose two styles disagree on the %s",
    async (part) => {
      const response = await notice(
        signedNotice(fullNotice(), { extra: { [`webhook-${part}`]: "different-synthetic" } })
      );
      expect(response.status).toBe(401);
      expect(machine).not.toHaveBeenCalled();
    }
  );

  it("refuses a valid signature sent with the other style's id and timestamp", async () => {
    const signed = signedNotice(fullNotice());
    const mixed = new NextRequest(signed.url, {
      method: "POST",
      body: JSON.stringify(fullNotice()),
      headers: {
        "webhook-id": signed.headers.get("svix-id") as string,
        "webhook-timestamp": signed.headers.get("svix-timestamp") as string,
        "svix-signature": signed.headers.get("svix-signature") as string,
      },
    });
    expect((await notice(mixed)).status).toBe(401);
    expect(machine).not.toHaveBeenCalled();
  });

  it.each<HeaderStyle>(["svix", "webhook"])(
    "refuses a %s-* notice signed outside the five-minute window",
    async (style) => {
      const at = new Date(Date.now() - 6 * 60 * 1000);
      expect((await notice(signedNotice(fullNotice(), { style, at }))).status).toBe(401);
      expect(machine).not.toHaveBeenCalled();
    }
  );

  it("refuses a webhook-* notice signed with another key", async () => {
    const raw = JSON.stringify(fullNotice());
    const at = new Date();
    const other = `whsec_${Buffer.from("another-synthetic-signing-key-00").toString("base64")}`;
    const request = new NextRequest("https://verifymzansi.com/api/webhooks/ozow", {
      method: "POST",
      body: raw,
      headers: {
        "webhook-id": "msg_synthetic_0002",
        "webhook-timestamp": String(Math.floor(at.getTime() / 1000)),
        "webhook-signature": new Webhook(other).sign("msg_synthetic_0002", at, raw),
      },
    });
    expect((await notice(request)).status).toBe(401);
    expect(machine).not.toHaveBeenCalled();
  });
});

describe("test-mode payments in production", () => {
  // Full notices always carry IsTest: one that says test, or none, is refused.
  it.each([
    ["true", { IsTest: "True" }],
    ["missing", { IsTest: undefined }],
    ["unreadable", { IsTest: "yes" }],
    ["contradicted", { isTest: true }],
  ])("the notice refuses a full notice whose test flag is %s", async (_label, change) => {
    const response = await notice(signedNotice(fullNotice(change)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, rejected: "test_mode_mismatch" });
    expect(settled()).toEqual([]);
    expect(logged("Ozow notice refused", PAYMENT, "test_mode_mismatch")).toBe(true);
  });

  // A looked-up transaction that is sent with a flag saying test (or one that
  // cannot be read) is refused on every path.
  const testFlags = [
    ["true", { isTest: true }],
    ["the text True", { IsTest: "True" }],
    ["unreadable", { isTest: "maybe" }],
  ] as const;

  it.each(testFlags)(
    "the notice refuses a thin notice whose lookup's flag is %s",
    async (_l, change) => {
      lookup.transaction = apiTransaction(change);
      const response = await notice(signedNotice(thinNotice()));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true, rejected: "test_mode_mismatch" });
      expect(settled()).toEqual([]);
    }
  );

  it.each(testFlags)(
    "the status check refuses a transaction whose flag is %s",
    async (_l, change) => {
      lookup.transactions = [apiTransaction(change)];
      const response = await runReconcile();
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ failures: 1 });
      expect(settled()).toEqual([]);
      expect(
        logged("Ozow transaction refused by the status check", PAYMENT, "test_mode_mismatch")
      ).toBe(true);
    }
  );

  it.each(testFlags)(
    "the member's status page refuses a transaction whose flag is %s",
    async (_l, change) => {
      lookup.transactions = [apiTransaction(change)];
      const response = await readStatus();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "pending", terminal: false, expired: false });
      expect(commands()).toContain("claim_payment_reconciliation");
      expect(settled()).toEqual([]);
    }
  );

  it("each path settles Ozow's published transaction, which has no flag, from the live host", async () => {
    expect((await notice(signedNotice(thinNotice()))).status).toBe(200);
    expect((await runReconcile()).status).toBe(200);
    expect((await readStatus()).status).toBe(200);
    expect(settled()).toHaveLength(3);
    const hosts = new Set(ozow.mock.calls.map(([input]) => new URL(String(input)).host));
    expect([...hosts]).toEqual(["one.ozow.com"]);
  });

  it("each path settles a transaction whose flag says it is not a test one", async () => {
    lookup.transaction = apiTransaction({ isTest: false });
    lookup.transactions = [apiTransaction({ isTest: "False" })];
    expect((await notice(signedNotice(thinNotice()))).status).toBe(200);
    expect((await runReconcile()).status).toBe(200);
    expect((await readStatus()).status).toBe(200);
    expect(settled()).toHaveLength(3);
  });

  it("production refuses a non-live Ozow address before any lookup", async () => {
    vi.stubEnv("OZOW_API_BASE_URL", "https://stagingone.ozow.com");
    expect((await notice(signedNotice(thinNotice()))).status).toBe(500);
    expect(ozow).not.toHaveBeenCalled();
    expect(settled()).toEqual([]);
  });

  it("Ozow's test system keeps today's rules for lookups", async () => {
    vi.stubEnv("OZOW_ENV", "staging");
    lookup.transaction = apiTransaction({ isTest: true });
    expect((await notice(signedNotice(thinNotice()))).status).toBe(200);
    expect(settled()).toHaveLength(1);
  });
});

describe("a correctly signed notice that can never apply", () => {
  it.each([
    ["an unknown payment", fullNotice(), () => (stored = null), "unknown_payment", null],
    ["a wrong amount", fullNotice({ Amount: "49.99" }), () => {}, "amount_mismatch", PAYMENT],
    [
      "a wrong site",
      fullNotice({ SiteCode: "OTHER-SITE" }),
      () => {},
      "site_code_mismatch",
      PAYMENT,
    ],
    [
      "a wrong currency",
      fullNotice({ CurrencyCode: "USD" }),
      () => {},
      "currency_mismatch",
      PAYMENT,
    ],
    [
      "an unknown status",
      fullNotice({ Status: "PendingInvestigation" }),
      () => {},
      "unsupported_transaction_status",
      PAYMENT,
    ],
    [
      "another payment request",
      fullNotice({ paymentRequestId: uuid(9) }),
      () => {},
      "payment_id_mismatch",
      PAYMENT,
    ],
  ])("is logged with its reason and answered 200: %s", async (_case, body, arrange, reason, id) => {
    arrange();
    const response = await notice(signedNotice(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, rejected: reason });
    expect(settled()).toEqual([]);
    expect(logged("Ozow notice refused", id, reason)).toBe(true);
  });

  it.each(["amount_mismatch", "currency_mismatch", "transaction_id_mismatch"])(
    "logs %s as an error for staff",
    async (reason) => {
      const body =
        reason === "amount_mismatch"
          ? fullNotice({ Amount: "49.99" })
          : reason === "currency_mismatch"
            ? fullNotice({ CurrencyCode: "USD" })
            : fullNotice();
      if (reason === "transaction_id_mismatch")
        stored = storedPayment({ status: "complete", provider_transaction_id: uuid(8) });
      await notice(signedNotice(body));
      expect(error).toHaveBeenCalledWith("Ozow notice refused", { paymentId: PAYMENT, reason });
    }
  );

  it.each([
    [
      "no merchant reference",
      fullNotice({ TransactionReference: undefined }),
      "missing_merchant_reference",
    ],
    ["no status", fullNotice({ Status: undefined }), "missing_transaction_status"],
  ])("is logged with its reason and answered 200: %s", async (_case, body, reason) => {
    const response = await notice(signedNotice(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, rejected: reason });
    expect(machine).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("Ozow notice refused", { paymentId: null, reason });
  });

  it("never gets unreadable JSON past the signing library, which reads the body", async () => {
    const raw = "{not json";
    const at = new Date();
    const request = new NextRequest("https://verifymzansi.com/api/webhooks/ozow", {
      method: "POST",
      body: raw,
      headers: {
        "svix-id": "msg_synthetic_0003",
        "svix-timestamp": String(Math.floor(at.getTime() / 1000)),
        "svix-signature": new Webhook(SIGNING_SECRET_SYNTHETIC).sign("msg_synthetic_0003", at, raw),
      },
    });
    expect((await notice(request)).status).toBe(401);
    expect(machine).not.toHaveBeenCalled();
  });
});

describe("outages are answered 5xx so the notice is sent again", () => {
  it("when the database is unavailable", async () => {
    machine.mockResolvedValue({ data: null, error: { code: "57P01" } });
    const response = await notice(signedNotice(fullNotice()));
    expect(response.status).toBe(500);
    expect(response.headers.get("Retry-After")).toBe("30");
  });

  it("when the settlement command fails", async () => {
    machine.mockImplementation(async (name: string) =>
      name === "apply_provider_event" ? { data: null, error: { code: "53300" } } : database(name)
    );
    expect((await notice(signedNotice(fullNotice()))).status).toBe(500);
  });

  it("when Ozow's lookup for a thin notice is unavailable", async () => {
    ozow.mockImplementationOnce(async () => {
      throw new TypeError("network unavailable");
    });
    expect((await notice(signedNotice(thinNotice()))).status).toBe(500);
    expect(settled()).toEqual([]);
  });

  it("when the payment has no stored Ozow request yet", async () => {
    stored = storedPayment({ provider_request_id: null });
    expect((await notice(signedNotice(fullNotice()))).status).toBe(500);
    expect(settled()).toEqual([]);
  });

  it("when this server's Ozow setting is invalid", async () => {
    vi.stubEnv("OZOW_ENV", "");
    expect((await notice(signedNotice(fullNotice()))).status).toBe(500);
    expect(settled()).toEqual([]);
  });
});

describe("a repeated thin notice", () => {
  it("is applied again once Ozow reports a new status for the transaction", async () => {
    const body = thinNotice();
    for (const status of ["Pending", "Successful", "Refunded"]) {
      lookup.transaction = apiTransaction({ status });
      expect((await notice(signedNotice(body))).status).toBe(200);
    }
    const keys = settled().map(
      ([, args]) => (args as { p_event: { payload_sha256: string } }).p_event.payload_sha256
    );
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
  });

  it("records a later Refunded status and logs it for staff", async () => {
    machine.mockImplementation(async (name: string) =>
      name === "apply_provider_event"
        ? { data: { outcome: "late_status_ignored", payment_id: PAYMENT }, error: null }
        : database(name)
    );
    lookup.transaction = apiTransaction({ status: "Refunded" });
    const response = await notice(signedNotice(thinNotice()));
    expect(response.status).toBe(200);
    expect(settled()).toHaveLength(1);
    expect(error).toHaveBeenCalledWith("Ozow notice needs staff attention", {
      paymentId: PAYMENT,
      reason: "late_status_ignored",
    });
  });

  it("keeps the same key while nothing changed, so the database sees a repeat", async () => {
    const body = thinNotice();
    await notice(signedNotice(body));
    await notice(signedNotice(body));
    const keys = settled().map(
      ([, args]) => (args as { p_event: { payload_sha256: string } }).p_event.payload_sha256
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });
});
