// Mock payment provider for the checkout browser tests (M0.9c). Everything runs
// in the test process on this machine; nothing here contacts Ozow.
//
// - The payment page: the website's mock checkout sends the browser to
//   https://127.0.0.1:55455/checkout (src/lib/payments/ozow.ts, test copy only),
//   which the spec serves through Playwright routing (handle below). Its
//   buttons pay, decline or cancel at a "test bank"; a cancel is recorded as
//   an Error transaction and closes the request (it then reads "Cancelled"),
//   as the code assumes Ozow reports one (to confirm in Ozow's test system,
//   M3.5).
// - The notification: paying signs a complete transaction notice with the
//   copy's synthetic signing secret and POSTs it to the website's real
//   notification route, as the provider's signing service would. It can be
//   withheld to model a lost notification.
// - The lookup API: a loopback HTTP stand-in on 127.0.0.1:55448 answers the
//   website's status checks (payment request status and its transactions) and
//   its cancellation of a pending request (afterwards the request reads
//   "Cancelled"). The
//   website sends lookups there only in the test copy with mock Ozow on
//   (testCopyCheckout().providerOrigin). Every lookup is recorded.
//
// The notice and lookup shapes are the ones the website's parser reads
// (normalizeOzowWebhook); they encode the code's assumptions about the
// provider, not verified provider behaviour.
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Webhook } from "svix";
import {
  E2E_FIXTURE,
  LOCAL_OZOW_SITE_CODE,
  LOCAL_OZOW_WEBHOOK_SECRET,
} from "../../../scripts/lib/foundation-e2e-target.mjs";
import { queryTestCopy } from "./test-copy";

export const MOCK_PAYMENT_ORIGIN = `https://127.0.0.1:${E2E_FIXTURE.mockPaymentPort}`;
const PROVIDER_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.providerPort}`;
const APP_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.appPort}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type ProviderLookup = { method: string; path: string; query: string; credentials: boolean };
type SentNotification = {
  paymentId: string;
  transactionId: string;
  status: number;
  body: unknown;
};
type Served = { status: number; headers?: Record<string, string>; body?: string };
type SignedNotice = { body: string; headers: Record<string, string> };

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );

function page(title: string, body: string): Served {
  return {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: [
      "<!doctype html>",
      `<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>`,
      `<body>${body}</body></html>`,
    ].join(""),
  };
}

/** The payment request the website's mock checkout stored for a payment. */
function storedRequest(paymentId: string) {
  const row = queryTestCopy(
    "select merchant_reference, amount_cents, coalesce(provider_request_id, ''), status " +
      `from private.payments where id = '${paymentId}';`
  );
  const [merchantReference, amountCents, requestId, status] = row.split("|");
  return { merchantReference, amountCents: Number(amountCents), requestId, status };
}

export class MockOzow {
  /** Lookups the website sent to the stand-in, in order. */
  readonly lookups: ProviderLookup[] = [];
  /** Requests the website cancelled at the stand-in. */
  readonly cancelled = new Set<string>();
  /** Payments made, declined or cancelled at the test bank, in order. */
  readonly made: { paymentId: string; transactionId: string; status: string }[] = [];
  /** Notifications sent to the website, with its replies. */
  readonly notifications: SentNotification[] = [];
  /** False: a payment is made but its notification never reaches the website. */
  sendNotifications = true;
  /** False: the member closes the provider's page instead of being sent back. */
  memberReturns = true;
  /** The last signed notice, for replay and tampering checks. */
  lastNotice: SignedNotice | null = null;
  private readonly transactions = new Map<string, Record<string, unknown>[]>();
  private server: Server | null = null;

  async start() {
    const server = createServer((request, response) => this.answer(request, response));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(E2E_FIXTURE.providerPort, "127.0.0.1", () => resolve());
    });
    this.server = server;
  }

  async stop() {
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** The stand-in for the provider's lookup API. */
  private answer(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? "/", PROVIDER_ORIGIN);
    this.lookups.push({
      method: request.method ?? "",
      path: url.pathname,
      query: url.search,
      credentials: Boolean(request.headers.authorization || request.headers.cookie),
    });
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
    };
    const cancel = /^\/v1\/payments\/([^/]+)\/cancel$/.exec(url.pathname);
    if (cancel && request.method === "POST") {
      const id = decodeURIComponent(cancel[1]);
      this.cancelled.add(id);
      return json(200, { id, status: "Cancelled" });
    }
    if (request.method !== "GET") return json(405, { title: "Method not allowed" });
    const list = /^\/v1\/payments\/([^/]+)\/transactions$/.exec(url.pathname);
    if (list)
      return json(200, {
        results: this.transactions.get(decodeURIComponent(list[1])) ?? [],
        links: { next: null },
      });
    const payment = /^\/v1\/payments\/([^/]+)$/.exec(url.pathname);
    // Not modelled: expiry. Every request the stand-in is asked about is open
    // until the website cancels it.
    if (payment) {
      const id = decodeURIComponent(payment[1]);
      return json(200, { id, status: this.cancelled.has(id) ? "Cancelled" : "Created" });
    }
    const single = /^\/v1\/transactions\/([^/]+)$/.exec(url.pathname);
    if (single) {
      const id = decodeURIComponent(single[1]);
      const found = [...this.transactions.values()].flat().find((entry) => entry.id === id);
      return found ? json(200, found) : json(404, { title: "Transaction not found" });
    }
    return json(404, { title: "Not found" });
  }

  /** Browser requests to the mock payment page's origin. */
  async handle(url: URL): Promise<Served> {
    const paymentId = url.searchParams.get("paymentId") ?? "";
    const returnUrl = url.searchParams.get("returnUrl") ?? "";
    if (!UUID.test(paymentId) || returnUrl !== `${APP_ORIGIN}/billing/success?payment=${paymentId}`)
      return { ...page("Mock Ozow", "<h1>Unknown payment request</h1>"), status: 400 };
    if (url.pathname === "/checkout") {
      const amount = url.searchParams.get("amount") ?? "";
      const shown = /^[0-9]{1,9}\.[0-9]{2}$/.test(amount) ? `R ${amount}` : "unknown amount";
      return page(
        "Mock Ozow",
        "<h1>Mock Ozow test payment</h1>" +
          `<p>Amount: ${escapeHtml(shown)}</p>` +
          '<form method="get" action="/pay">' +
          `<input type="hidden" name="paymentId" value="${escapeHtml(paymentId)}">` +
          `<input type="hidden" name="returnUrl" value="${escapeHtml(returnUrl)}">` +
          '<button type="submit" name="outcome" value="paid">Pay with the test bank</button>' +
          '<button type="submit" name="outcome" value="declined">Decline at the test bank</button>' +
          '<button type="submit" name="outcome" value="cancelled">Cancel at the test bank</button>' +
          "</form>"
      );
    }
    const outcome = url.searchParams.get("outcome");
    if (
      url.pathname !== "/pay" ||
      (outcome !== "paid" && outcome !== "declined" && outcome !== "cancelled")
    )
      return { ...page("Mock Ozow", "<h1>Unknown action</h1>"), status: 400 };
    await this.settle(paymentId, outcome === "paid" ? "Successful" : "Error");
    if (outcome === "cancelled") this.cancelled.add(`mock-${paymentId}`);
    if (!this.memberReturns)
      return page(
        "Mock Ozow",
        "<h1>Payment made at the test bank</h1><p>You can close this window.</p>"
      );
    return { status: 302, headers: { Location: returnUrl } };
  }

  /**
   * A transaction at the test bank that no notice reports (a lost or later
   * notice): only the lookup stand-in shows it, so the status check finds it.
   * `amountCents` overrides the payment's amount. Returns its id.
   */
  addTransaction(paymentId: string, status: "Successful" | "Error", amountCents?: number) {
    const stored = storedRequest(paymentId);
    if (stored.requestId !== `mock-${paymentId}`)
      throw new Error("The mock provider has no request for this payment");
    const transactionId = randomUUID();
    const list = this.transactions.get(stored.requestId) ?? [];
    list.push({
      id: transactionId,
      paymentRequestId: stored.requestId,
      merchantReference: stored.merchantReference,
      siteCode: LOCAL_OZOW_SITE_CODE,
      status,
      amount: { currency: "ZAR", value: (amountCents ?? stored.amountCents) / 100 },
    });
    this.transactions.set(stored.requestId, list);
    this.made.push({ paymentId, transactionId, status });
    return transactionId;
  }

  /** The test bank's answer: a transaction on the request, then the notice. */
  private async settle(paymentId: string, status: "Successful" | "Error") {
    const stored = storedRequest(paymentId);
    // The provider only knows requests it created: the copy's mock checkout.
    if (
      stored.requestId !== `mock-${paymentId}` ||
      stored.status !== "pending" ||
      this.cancelled.has(stored.requestId)
    )
      throw new Error("The mock provider has no open request for this payment");
    const transactionId = randomUUID();
    const amount = (stored.amountCents / 100).toFixed(2);
    const list = this.transactions.get(stored.requestId) ?? [];
    list.push({
      id: transactionId,
      paymentRequestId: stored.requestId,
      merchantReference: stored.merchantReference,
      siteCode: LOCAL_OZOW_SITE_CODE,
      status,
      amount: { currency: "ZAR", value: stored.amountCents / 100 },
    });
    this.transactions.set(stored.requestId, list);
    this.made.push({ paymentId, transactionId, status });
    if (!this.sendNotifications) return;
    const reply = await this.notify({
      TransactionId: transactionId,
      TransactionReference: stored.merchantReference,
      SiteCode: LOCAL_OZOW_SITE_CODE,
      IsTest: "True",
      Status: status,
      Amount: amount,
      CurrencyCode: "ZAR",
      paymentRequestId: stored.requestId,
    });
    this.notifications.push({ paymentId, transactionId, ...reply });
  }

  /** Signs a complete transaction notice and POSTs it to the website. */
  async notify(data: Record<string, unknown>, secret = LOCAL_OZOW_WEBHOOK_SECRET) {
    const body = JSON.stringify({ type: "transaction.complete", data });
    const id = `msg_${randomUUID().replaceAll("-", "")}`;
    const at = new Date();
    const notice = {
      body,
      headers: {
        "Content-Type": "application/json",
        "svix-id": id,
        "svix-timestamp": String(Math.floor(at.getTime() / 1000)),
        "svix-signature": new Webhook(secret).sign(id, at, body),
      },
    };
    this.lastNotice = notice;
    return this.post(notice);
  }

  /** Sends a signed notice to the website's notification route as it is. */
  async post(notice: SignedNotice) {
    const response = await fetch(new URL("/api/webhooks/ozow", APP_ORIGIN), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: notice.headers,
      body: notice.body,
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON; keep the text.
    }
    return { status: response.status, body };
  }
}
