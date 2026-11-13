import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  E2E_FIXTURE,
  LOCAL_INTERNAL_JOBS_SECRET,
  LOCAL_OPS_JOBS_SECRET,
} from "../../scripts/lib/foundation-e2e-target.mjs";
import { characterise, KnownBreak, requireOnlyKnownBreak } from "./support/known-break";
import { MOCK_PAYMENT_ORIGIN, MockOzow } from "./support/mock-ozow";
import { endedWithTest } from "./support/route-teardown";
import {
  browserSessionCookies,
  caughtMailFor,
  outboxState,
  queryTestCopy,
  readOutboundAttempts,
  readTestCopy,
  readServerLogEntries,
  rpc,
  serverLogMentions,
  serviceRpc,
  signIn,
  type TestCopy,
} from "./support/test-copy";
import {
  registerUnreviewedMember,
  registerVerifiedMember,
  type VerifiedMember,
} from "./support/verified-member";

// Critical-flow test (M0.9c): the money journey on the restored website in
// foundation mode against the private test copy. A new verified member per
// run (no plan, no trial) chooses an Individual slot (Pricing v2 P2), ticks the
// cooling-off box, pays through mock Ozow, and the signed notification settles
// it; the slot becomes active and a post uses it; the checkout total equals
// the pricing page for every package, and a two-slot order is one payment with
// one slot per line; a member whose ID review is not accepted cannot pay
// (M3.8); a lost notification is settled by the 10-minute status check; a
// payment declined at the bank can be paid again; a plan with a pending
// payment shows the restored Continue and Cancel controls, and Cancel works; a
// bank attempt cancelled at the provider, whose notice has not arrived, shows
// as not paid instead of "Payment pending"; a failed first attempt to open the
// payment page can be retried later (M3.1); the Urgent add-on step says add-ons
// open soon and takes no payment (paid add-on sales are paused, M1.9); the
// receipt email arrives; a paid Urgent add-on shows its label.
//
// The copy's website runs with paid add-on sales paused, as production does
// (ADDON_SALES_ENABLED, src/lib/billing/addon-sales.ts); the plan steps above
// run on that same server, so pausing add-ons leaves plans working.
//
// Two steps are broken today and are marked test.fail(), each pinned to its
// exact known symptom (characterise, support/known-break.ts); any other
// outcome turns the run red:
// - "the receipt email ... payment details": PAY-06, fixed by M3.7. The
//   "Payment received" email has no amount, date, plan, bank reference or
//   invoice number, and sends the member to Billing for an invoice.
// - "a paid Urgent add-on shows its label": BL-05, fixed by M1.10. The
//   website sells no add-on while sales are paused, so the payment is arranged
//   as one made before the pause (trusted local steps) and paid at the mock;
//   it settles and the owner sees "Already urgent", but visitors see no Urgent
//   label. M1.10 buys it through the button again and removes the mark.
// The tests share one member and run in order; a failure skips the rest, so
// the marked steps come after the working flows.
//
// The provider is the copy's mock (support/mock-ozow.ts): its payment page is
// served here, paying sends a notice signed with the copy's synthetic secret to
// the website's real notification route (real signature check), and its
// lookup stand-in on 127.0.0.1 answers the status checks. Ozow is never
// contacted: browser requests may only reach the copy's website, its database
// gateway and the mock payment page (anything else is aborted and fails the
// test), and the website's own server runs behind the copy's outbound fence,
// whose log must show no new request at all.
//
// The member's business post goes to the website route its form posts to
// (POST /api/businesses, as in member-post-publish.spec.ts: the form page
// cannot open until M1.1), and a moderator approves it through the production
// commands (the staff screens are M0.9d).

const APP_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.appPort}`;
const API_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.apiPort}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PAY06 = "PAY-06, fixed by M3.7";
const BL05 = "BL-05, fixed by M1.10";
/** The restored checkout page's notice for a plan with a pending payment. */
const PENDING_NOTICE =
  "You already have a pending payment for this area. Continue the payment or cancel it before choosing another plan.";
const URGENT_BUTTON = "Mark this business profile as urgent (R10 for 7 days)";
/** The server's reply to any add-on checkout while sales are paused. */
const ADDONS_PAUSED = {
  error: "Add-ons open soon. You have not been charged.",
  code: "addon_sales_paused",
};
const ADDONS_PAUSED_LOG = "Paid add-on checkout refused while add-on sales are paused";
/** Today's "Payment received" email body (src/lib/services/email.ts). */
const RECEIPT_TODAY =
  /^Payment received\s+Your payment has been recorded\. View your posting allowance and invoice in Billing\.\s+Sign in to view the details: https:\/\/\S+\/billing\s*$/;

// A service worker could fetch outside page routing; the allowlist must see every request.
test.use({ serviceWorkers: "block" });
test.describe.configure({ mode: "serial" });

type Plan = { id: string; code: string; label: string; price_cents: string };
type Addon = { id: string; kind: string; days: number; price_cents: string };
type Reply = { method: string; path: string; status: number; body: unknown };
type Payment = { id: string; requestId: string; merchantReference: string };

const ozow = new MockOzow();

/** Lets only the copy's website, its gateway and the mock payment page through,
 * serves the mock payment page, and records the website's API replies. */
async function guard(context: BrowserContext) {
  const outside: string[] = [];
  const failures: string[] = [];
  const replies: Reply[] = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === MOCK_PAYMENT_ORIGIN) {
      try {
        const served = await ozow.handle(url);
        return await route.fulfill(served);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
        return route.fulfill({ status: 500, body: "Mock provider failure" });
      }
    }
    if (url.origin !== APP_ORIGIN && url.origin !== API_ORIGIN) {
      outside.push(url.origin);
      return route.abort("blockedbyclient");
    }
    if (
      url.origin !== APP_ORIGIN ||
      !url.pathname.startsWith("/api/") ||
      request.method() === "GET"
    )
      return route.continue();
    let response;
    let bytes: Buffer;
    try {
      response = await route.fetch({ maxRedirects: 0 });
      bytes = await response.body();
    } catch (error) {
      // The test already ended (its page closed mid-request); nothing to record.
      if (endedWithTest(error)) return;
      // Recorded, not thrown: every step checks `failures`, and an error in a
      // route handler would otherwise fail a marked test outside its pin.
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${request.method()} ${url.pathname}: ${message.slice(0, 200)}`);
      return route.abort("failed").catch(() => undefined);
    }
    let body: unknown = `${bytes.length} bytes`;
    if (/json/i.test(response.headers()["content-type"] ?? ""))
      try {
        body = JSON.parse(bytes.toString("utf8"));
      } catch {
        // Malformed JSON; keep the size only.
      }
    replies.push({ method: request.method(), path: url.pathname, status: response.status(), body });
    return route.fulfill({ response, body: bytes });
  });
  const reply = (pathname: string) => replies.filter((entry) => entry.path === pathname);
  return { outside, failures, reply };
}

/** The website's server tried nothing off this machine since `mark` (the
 * copy's outbound fence records every such attempt, by origin). */
function expectNoOutboundSince(mark: number) {
  expect(readOutboundAttempts().slice(mark)).toEqual([]);
}

async function signInBrowser(context: BrowserContext, person: VerifiedMember) {
  const session = await browserSessionCookies(readTestCopy(), person);
  expect(session.accountId).toBe(person.id);
  await context.addCookies(session.cookies.map((cookie) => ({ ...cookie, url: APP_ORIGIN })));
}

function paymentRow(id: string) {
  const [status, fulfilment, kind, amount, request, transaction] = queryTestCopy(
    "select status, fulfillment_status, product_kind, amount_cents, coalesce(provider_request_id, ''), " +
      `coalesce(provider_transaction_id, '') from private.payments where id = '${id}';`
  ).split("|");
  return { status, fulfilment, kind, amount, request, transaction };
}

/** Every entitlement a payment created: source, area (none: any area),
 * status, slots, days, and its payment line's number. */
function entitlementsOf(paymentId: string) {
  return queryTestCopy(
    "select e.source, coalesce(e.area, 'any'), e.status, e.slot_capacity, " +
      "round(extract(epoch from e.ends_at - e.starts_at) / 86400), l.line_number " +
      "from private.entitlements e join private.payment_lines l on l.id = e.payment_line_id " +
      `where e.payment_id = '${paymentId}' order by l.line_number;`
  )
    .split("\n")
    .filter(Boolean);
}

/** The posting allowance the member's posting forms read. */
async function allowance(page: Page, area: "MZANSI_BUSINESS" | "MZANSI_MARKET") {
  return page.evaluate(async (section) => {
    const response = await fetch(`/api/billing/allowance?area=${section}`, { cache: "no-store" });
    return { status: response.status, body: await response.json() };
  }, area);
}

/** The checkout's cooling-off box (posting-v4): no tick, no payment. */
async function tickCoolingOff(page: Page) {
  await page.getByRole("checkbox", { name: /^My slot starts now/ }).check();
}

/** From the confirmation page to the mock payment page; a new quote each time. */
async function checkoutToMockPage(page: Page, reply: (path: string) => Reply[], plan: Plan) {
  await page.goto(`/billing/checkout?plan=${plan.id}`);
  await expect(page.getByRole("heading", { name: "Confirm your plan" })).toBeVisible();
  await expect(page.getByText(plan.label, { exact: true })).toBeVisible();
  const before = reply("/api/billing/create-checkout").length;
  await tickCoolingOff(page);
  await page.getByRole("button", { name: /^Pay .+ securely$/ }).click();
  await page.waitForURL((url) => url.origin === MOCK_PAYMENT_ORIGIN);
  await expect(page.getByRole("heading", { name: "Mock Ozow test payment" })).toBeVisible();
  const created = reply("/api/billing/create-checkout").slice(before);
  expect(created).toEqual([expect.objectContaining({ status: 200 })]);
  const id = (created[0].body as { paymentId: string }).paymentId;
  expect(id).toMatch(UUID);
  expect(new URL(page.url()).searchParams.get("paymentId")).toBe(id);
  expect(paymentRow(id)).toMatchObject({
    status: "pending",
    kind: "plan",
    amount: plan.price_cents,
    request: `mock-${id}`,
  });
  return paymentOf(id);
}

function paymentOf(id: string): Payment {
  const [requestId, merchantReference] = queryTestCopy(
    `select provider_request_id, merchant_reference from private.payments where id = '${id}';`
  ).split("|");
  return { id, requestId, merchantReference };
}

/** Runs the website's job route once, as the ops-jobs Worker does every minute. */
async function runOpsJob(request: APIRequestContext) {
  const response = await request.post("/api/webhooks/ops-jobs", {
    headers: { Authorization: `Bearer ${LOCAL_OPS_JOBS_SECRET}` },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as { claimed: number; succeeded: number; retrying: number };
}

async function call(copy: TestCopy, name: string, body: unknown, token?: string) {
  const result = await rpc(copy, name, body, token);
  if (result.status !== 200) throw new Error(`Command ${name} answered ${result.status}`);
  return result.data;
}

function postExists(id: string) {
  return queryTestCopy(`select count(*) from private.posts where id = '${id}';`) !== "0";
}

/** Deletes the member's post with the command the website's Delete button uses. */
async function deleteByCommand(id: string) {
  const session = await signIn(copy, member);
  const revision = Number(queryTestCopy(`select revision from private.posts where id = '${id}';`));
  await call(
    copy,
    "execute_my_frontend_post_action",
    {
      p_request: randomUUID(),
      p_post: id,
      p_expected_revision: revision,
      p_action: "delete",
      p_kind: "business",
      p_area: "business",
    },
    session.token
  );
}

// Made in beforeAll, never at import time: listing specs must not touch the copy.
let copy: TestCopy;
let member: VerifiedMember;
let plans: Record<"business" | "market" | "tourism" | "retry" | "pending" | "cancelled", Plan>;
let urgent: Addon;
let planPayment: Payment;
let business: { name: string; id: string };

test.describe("checkout to fulfilment", () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    copy = readTestCopy();
    const catalogue = await rpc(copy, "billing_catalogue", {});
    expect(catalogue.status).toBe(200);
    const byCode = (code: string) => {
      const plan = (catalogue.data.plans as Plan[]).find((entry) => entry.code === code);
      if (!plan) throw new Error(`The catalogue has no plan ${code}`);
      return plan;
    };
    // One Individual slot works in every section (Pricing v2): the flows use
    // its three terms, one open payment per term at a time.
    plans = {
      business: byCode("individual_30d"),
      market: byCode("individual_30d"),
      tourism: byCode("individual_30d"),
      retry: byCode("individual_90d"),
      pending: byCode("individual_90d"),
      cancelled: byCode("individual_180d"),
    };
    const addon = (catalogue.data.addons as Addon[]).find(
      (entry) => entry.kind === "urgent" && entry.days === 7
    );
    if (!addon) throw new Error("The catalogue has no 7-day Urgent add-on");
    urgent = addon;
    member = await registerVerifiedMember("payer");
    business = { name: `Paid Studio ${member.lastName.slice(-8)}`, id: "" };
    await ozow.start();
  });

  // A marked step may fail only through its known break (support/known-break.ts).
  test.afterEach(({}, testInfo) => requireOnlyKnownBreak(testInfo));

  test.afterAll(async () => {
    try {
      // Leave no public post behind when a step failed before the member
      // deleted it: the copy's showroom is shared with the other specs.
      if (business?.id && postExists(business.id)) await deleteByCommand(business.id);
    } finally {
      await ozow.stop();
    }
  });

  test("a member chooses a plan, pays at mock Ozow, and the signed notification activates it", async ({
    context,
    page,
  }) => {
    const mark = readOutboundAttempts().length;
    const { outside, failures, reply } = await guard(context);
    await signInBrowser(context, member);
    const shortcut = page
      .getByRole("region", { name: "Shortcuts" })
      .getByRole("link", { name: /Plans and billing/ });
    await page.goto("/dashboard");
    await expect(shortcut).toContainText("No paid plan yet");

    planPayment = await checkoutToMockPage(page, reply, plans.business);
    await page.getByRole("button", { name: "Pay with the test bank" }).click();
    await page.waitForURL(`${APP_ORIGIN}/billing/success?payment=${planPayment.id}`);
    await expect(page.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();

    // One signed notice, accepted by the real route and settled in SQL.
    expect(ozow.notifications.filter((entry) => entry.paymentId === planPayment.id)).toEqual([
      {
        paymentId: planPayment.id,
        transactionId: expect.stringMatching(UUID),
        status: 200,
        body: {
          success: true,
          result: {
            outcome: "completed",
            payment_id: planPayment.id,
            fulfillment_status: "fulfilled",
          },
        },
      },
    ]);
    const { transactionId } = ozow.notifications.at(-1)!;
    expect(paymentRow(planPayment.id)).toEqual({
      status: "complete",
      fulfilment: "fulfilled",
      kind: "plan",
      amount: plans.business.price_cents,
      request: planPayment.requestId,
      transaction: transactionId,
    });
    expect(entitlementsOf(planPayment.id)).toEqual(["retail_paid|any|active|1|30|1"]);

    // The plan is active for the member: dashboard shortcut and posting allowance.
    await page.goto("/dashboard");
    await expect(shortcut).toContainText(plans.business.label);
    expect(await allowance(page, "MZANSI_BUSINESS")).toMatchObject({
      status: 200,
      body: { capacity: 1, used: 0, hasPaidPlan: true, sources: ["retail_paid"] },
    });

    // The real signature check: a replayed notice changes nothing, a notice
    // signed with another secret is refused.
    const notice = ozow.lastNotice!;
    expect(await ozow.post(notice)).toMatchObject({
      status: 200,
      body: { success: true, result: { outcome: "duplicate_event", payment_id: planPayment.id } },
    });
    const forged = await ozow.notify(
      JSON.parse(notice.body).data,
      `whsec_${Buffer.from("not the copy's notification secret").toString("base64")}`
    );
    expect(forged).toEqual({ status: 401, body: { error: "Invalid webhook signature" } });
    expect(entitlementsOf(planPayment.id)).toHaveLength(1);

    expect(failures).toEqual([]);
    expect(outside).toEqual([]);
    expectNoOutboundSince(mark);
  });

  test("a business post uses the paid plan's slot and goes live after review", async ({
    context,
    page,
  }) => {
    const mark = readOutboundAttempts().length;
    const { outside, failures } = await guard(context);
    await signInBrowser(context, member);
    // Any member page gives the browser the CSRF cookie the form would use.
    await page.goto("/dashboard");
    const submitted = await page.evaluate(
      async ({ name, slug }) => {
        const token = document.cookie.match(/(?:^|; )vm_csrf=([a-f0-9]{64})/)?.[1] ?? "";
        const terms = await fetch("/api/foundation/posting-terms", { cache: "no-store" }).then(
          (response) => response.json()
        );
        const response = await fetch("/api/businesses", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "x-csrf-token": token },
          body: JSON.stringify({
            postRequestId: crypto.randomUUID(),
            postingTerms: { version: terms.version, document_hash: terms.document_hash },
            business_name: name,
            slug,
            business_type: "online_only",
            category: "general_other",
            description: "Hand-printed posters and frames, ordered online and delivered.",
            location_province: "KwaZulu-Natal",
            location_city: "Richards Bay",
            contact_methods: ["form"],
            category_details: {
              customer_access: { version: 2, methods: ["online"], publishAddress: false },
            },
            termsAccepted: true,
          }),
        });
        return { status: response.status, body: await response.json() };
      },
      { name: business.name, slug: `paid-studio-${member.lastName.slice(-8)}` }
    );
    expect(submitted).toMatchObject({
      status: 200,
      body: { success: true, pendingReview: true, status: "pending_moderation" },
    });
    business.id = (submitted.body as { id: string }).id;
    expect(business.id).toMatch(UUID);

    // The submission took the paid plan's slot (the member has nothing else).
    expect(
      queryTestCopy(
        "select e.source, e.payment_id from private.post_activations a " +
          "join private.entitlements e on e.id = a.entitlement_id " +
          `where a.post_id = '${business.id}' and a.released_at is null;`
      )
    ).toBe(`retail_paid|${planPayment.id}`);
    expect(await allowance(page, "MZANSI_BUSINESS")).toMatchObject({
      status: 200,
      body: { capacity: 1, used: 1, hasPaidPlan: true },
    });

    // A moderator approves it (production commands; the staff screens are M0.9d).
    const moderator = await signIn(copy, "moderator");
    const revision = Number(
      queryTestCopy(`select revision from private.posts where id = '${business.id}';`)
    );
    const lease = await call(
      copy,
      "claim_queue_item",
      { p_subject: "post", p_id: business.id },
      moderator.token
    );
    await call(
      copy,
      "moderate_post",
      {
        p_post_id: business.id,
        p_expected_revision: revision,
        p_decision: "approve",
        p_reason: null,
        p_claim_generation: lease.claim_generation,
        p_claim_nonce: lease.claim_nonce,
      },
      moderator.token
    );
    expect(queryTestCopy(`select status from private.posts where id = '${business.id}';`)).toBe(
      "live"
    );
    await context.clearCookies();
    await page.goto(`/mzansi-business/${business.id}`);
    await expect(page.getByText(business.name).filter({ visible: true }).first()).toBeVisible();
    expect(failures).toEqual([]);
    expect(outside).toEqual([]);
    expectNoOutboundSince(mark);
  });

  test("a payment whose notification is lost is settled by the 10-minute status check", async ({
    context,
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const mark = readOutboundAttempts().length;
    const { outside, failures, reply } = await guard(context);
    await signInBrowser(context, member);
    const lost = await checkoutToMockPage(page, reply, plans.market);
    // The member pays; neither the notice nor the member comes back.
    ozow.sendNotifications = false;
    ozow.memberReturns = false;
    try {
      await page.getByRole("button", { name: "Pay with the test bank" }).click();
      await expect(
        page.getByRole("heading", { name: "Payment made at the test bank" })
      ).toBeVisible();
    } finally {
      ozow.sendNotifications = true;
      ozow.memberReturns = true;
    }
    await page.close();
    expect(ozow.notifications.filter((entry) => entry.paymentId === lost.id)).toEqual([]);
    expect(paymentRow(lost.id).status).toBe("pending");
    expect(entitlementsOf(lost.id)).toEqual([]);

    // The status check: the payment-cleanup Worker calls this route every 10
    // minutes with the job secret. Without it the route refuses.
    const job = (secret: string) =>
      request.post("/api/internal/payments/reconcile", {
        headers: { Authorization: `Bearer ${secret}` },
        maxRedirects: 0,
      });
    expect((await job("not-the-job-secret")).status()).toBe(401);
    const lookups = ozow.lookups.length;
    // Each run checks up to 20 payments, the never-checked first (oldest
    // first), so earlier runs' leftovers can take a run or two.
    for (let run = 0; run < 5 && paymentRow(lost.id).status === "pending"; run++) {
      const response = await job(LOCAL_INTERNAL_JOBS_SECRET);
      expect(response.status()).toBe(200);
      expect(await response.json()).toMatchObject({ failures: 0 });
    }
    const made = ozow.made.filter((entry) => entry.paymentId === lost.id);
    expect(made).toEqual([
      { paymentId: lost.id, transactionId: expect.stringMatching(UUID), status: "Successful" },
    ]);
    expect(paymentRow(lost.id)).toEqual({
      status: "complete",
      fulfilment: "fulfilled",
      kind: "plan",
      amount: plans.market.price_cents,
      request: lost.requestId,
      transaction: made[0].transactionId,
    });
    expect(entitlementsOf(lost.id)).toEqual(["retail_paid|any|active|1|30|1"]);
    // It asked the copy's stand-in about exactly this request, with no
    // credentials, and never Ozow (the fence saw nothing).
    const asked = ozow.lookups
      .slice(lookups)
      .filter((entry) => entry.path === `/v1/payments/${lost.requestId}/transactions`);
    expect(asked).toEqual([
      {
        method: "GET",
        path: `/v1/payments/${lost.requestId}/transactions`,
        query: expect.stringMatching(
          /^\?fromDate=\d{4}-\d{2}-\d{2}&toDate=\d{4}-\d{2}-\d{2}&limit=50&offset=0$/
        ),
        credentials: false,
      },
    ]);
    expect(ozow.lookups.filter((entry) => entry.credentials)).toEqual([]);

    // The member comes back later and sees it confirmed.
    const later = await context.newPage();
    await later.goto(`/billing/success?payment=${lost.id}`);
    await expect(later.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();
    expect(failures).toEqual([]);
    expect(outside).toEqual([]);
    expectNoOutboundSince(mark);
  });

  test("a payment declined at the bank can be paid again", async ({ context, page }) => {
    const mark = readOutboundAttempts().length;
    const { outside, failures, reply } = await guard(context);
    await signInBrowser(context, member);
    const declined = await checkoutToMockPage(page, reply, plans.tourism);
    await page.getByRole("button", { name: "Decline at the test bank" }).click();
    await page.waitForURL(`${APP_ORIGIN}/billing/success?payment=${declined.id}`);
    await expect(page.getByRole("heading", { name: "Payment didn't go through" })).toBeVisible();
    expect(ozow.notifications.at(-1)).toMatchObject({
      paymentId: declined.id,
      status: 200,
      body: { success: true, result: { outcome: "not_paid", payment_id: declined.id } },
    });
    expect(paymentRow(declined.id).status).toBe("failed");
    expect(entitlementsOf(declined.id)).toEqual([]);

    // Again: a new quote, paid this time.
    const paid = await checkoutToMockPage(page, reply, plans.tourism);
    expect(paid.id).not.toBe(declined.id);
    await page.getByRole("button", { name: "Pay with the test bank" }).click();
    await page.waitForURL(`${APP_ORIGIN}/billing/success?payment=${paid.id}`);
    await expect(page.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();
    expect(paymentRow(paid.id)).toMatchObject({ status: "complete", fulfilment: "fulfilled" });
    expect(entitlementsOf(paid.id)).toEqual(["retail_paid|any|active|1|30|1"]);
    expect(paymentRow(declined.id).status).toBe("failed");
    expect(failures).toEqual([]);
    expect(outside).toEqual([]);
    expectNoOutboundSince(mark);
  });

  test("a plan with a pending payment offers the restored Continue and Cancel, and Cancel works", async ({
    context,
    page,
  }) => {
    test.setTimeout(120_000);
    const mark = readOutboundAttempts().length;
    const { outside, failures, reply } = await guard(context);
    await signInBrowser(context, member);
    const open = await checkoutToMockPage(page, reply, plans.pending);
    const checkoutUrl = queryTestCopy(
      `select checkout_url from private.payments where id = '${open.id}';`
    );
    expect(new URL(checkoutUrl).origin).toBe(MOCK_PAYMENT_ORIGIN);

    // The member comes back to the confirmation page and pays again.
    const tryAgain = async () => {
      await page.goto(`/billing/checkout?plan=${plans.pending.id}`);
      await expect(page.getByRole("heading", { name: "Confirm your plan" })).toBeVisible();
      const before = reply("/api/billing/create-checkout").length;
      await tickCoolingOff(page);
      await page.getByRole("button", { name: /^Pay .+ securely$/ }).click();
      // The reply for an open payment asks the database and the provider; on a
      // busy test machine it took just over the 5-second default once.
      await expect
        .poll(() => reply("/api/billing/create-checkout").length, { timeout: 20_000 })
        .toBe(before + 1);
      return reply("/api/billing/create-checkout").at(-1) as Reply;
    };
    const answered = await tryAgain();
    expect(answered).toEqual({
      method: "POST",
      path: "/api/billing/create-checkout",
      status: 409,
      body: {
        error: PENDING_NOTICE,
        code: "PENDING_PAYMENT_EXISTS",
        pendingPayment: {
          id: open.id,
          checkoutUrl,
          statusUrl: `${APP_ORIGIN}/billing/success?payment=${open.id}`,
          canCancel: true,
          slots: 1,
          amountCents: Number(plans.pending.price_cents),
        },
      },
    });
    // The restored controls (src/app/billing/checkout/checkout-confirm.tsx),
    // unchanged from the selected frontend.
    await expect(page.getByRole("alert").filter({ hasText: PENDING_NOTICE })).toBeVisible();
    // Which order is unpaid: its slots and total.
    await expect(page.getByTestId("unpaid-order")).toHaveText(
      `Unpaid order: 1 slot, R${Number(plans.pending.price_cents) / 100}`
    );
    const resume = page.getByRole("link", { name: "Continue payment" });
    await expect(resume).toHaveAttribute("href", checkoutUrl);
    await expect(page.getByRole("link", { name: "Check status" })).toHaveAttribute(
      "href",
      `${APP_ORIGIN}/billing/success?payment=${open.id}`
    );
    const cancel = page.getByRole("button", { name: "Cancel pending payment" });
    await expect(cancel).toBeEnabled();
    await expect(page.getByRole("button", { name: /^Pay .+ securely$/ })).toBeEnabled();
    expect(paymentRow(open.id).status).toBe("pending");
    // No second payment and no second request at the provider.
    expect(
      queryTestCopy(
        `select count(*) from private.payments where owner_id = '${member.id}' and plan_version_id = '${plans.pending.id}';`
      )
    ).toBe("1");

    // Continue goes back to the same payment page.
    await resume.click();
    await page.waitForURL((url) => url.origin === MOCK_PAYMENT_ORIGIN);
    expect(new URL(page.url()).searchParams.get("paymentId")).toBe(open.id);
    await expect(page.getByRole("heading", { name: "Mock Ozow test payment" })).toBeVisible();

    // Cancel closes it at the provider and here.
    await tryAgain();
    const lookups = ozow.lookups.length;
    await page.getByRole("button", { name: "Cancel pending payment" }).click();
    await expect(page.getByRole("button", { name: "Cancel pending payment" })).toBeHidden();
    await expect(page.getByRole("link", { name: "Continue payment" })).toBeHidden();
    await expect(page.getByText(PENDING_NOTICE)).toBeHidden();
    expect(reply("/api/billing/cancel-pending")).toEqual([
      {
        method: "POST",
        path: "/api/billing/cancel-pending",
        status: 200,
        body: { success: true },
      },
    ]);
    expect(paymentRow(open.id)).toMatchObject({ status: "cancelled", request: open.requestId });
    expect(entitlementsOf(open.id)).toEqual([]);
    expect(ozow.cancelled.has(open.requestId)).toBe(true);
    expect(
      ozow.lookups
        .slice(lookups)
        .filter((entry) => entry.path === `/v1/payments/${open.requestId}/cancel`)
    ).toEqual([
      {
        method: "POST",
        path: `/v1/payments/${open.requestId}/cancel`,
        query: "",
        credentials: false,
      },
    ]);
    expect(ozow.lookups.filter((entry) => entry.credentials)).toEqual([]);

    // Paying again starts a new payment.
    await page.getByRole("button", { name: /^Pay .+ securely$/ }).click();
    await page.waitForURL((url) => url.origin === MOCK_PAYMENT_ORIGIN);
    const next = (reply("/api/billing/create-checkout").at(-1)?.body as { paymentId: string })
      .paymentId;
    expect(next).toMatch(UUID);
    expect(next).not.toBe(open.id);
    // Close it so it holds nothing for the later steps.
    await page.getByRole("button", { name: "Decline at the test bank" }).click();
    await page.waitForURL(`${APP_ORIGIN}/billing/success?payment=${next}`);
    expect(paymentRow(next).status).toBe("failed");
    expect(failures).toEqual([]);
    expect(outside).toEqual([]);
    expectNoOutboundSince(mark);
  });

  test("a bank attempt cancelled at the provider shows as not paid, not as pending", async ({
    context,
    page,
  }) => {
    test.setTimeout(120_000);
    const mark = readOutboundAttempts().length;
    const { outside, failures, reply } = await guard(context);
    await signInBrowser(context, member);
    const cancelled = await checkoutToMockPage(page, reply, plans.cancelled);
    // The member cancels at the provider and is sent back; the provider's
    // notice has not arrived.
    ozow.sendNotifications = false;
    try {
      await page.getByRole("button", { name: "Cancel at the test bank" }).click();
      await page.waitForURL(`${APP_ORIGIN}/billing/success?payment=${cancelled.id}`);
    } finally {
      ozow.sendNotifications = true;
    }
    expect(ozow.notifications.filter((entry) => entry.paymentId === cancelled.id)).toEqual([]);
    // The page's status check asks the provider and records the attempt.
    await expect(page.getByRole("heading", { name: "Payment didn't go through" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("heading", { name: "Payment pending" })).toBeHidden();
    const made = ozow.made.filter((entry) => entry.paymentId === cancelled.id);
    expect(made).toEqual([
      { paymentId: cancelled.id, transactionId: expect.stringMatching(UUID), status: "Error" },
    ]);
    expect(paymentRow(cancelled.id)).toMatchObject({
      status: "failed",
      fulfilment: "unfulfilled",
      request: cancelled.requestId,
      transaction: "",
    });
    expect(entitlementsOf(cancelled.id)).toEqual([]);
    expect(
      queryTestCopy(
        "select outcome || '|' || reported_status from private.provider_events " +
          `where payment_id = '${cancelled.id}';`
      )
    ).toBe("not_paid|error");
    // The member can pay for the plan again.
    const again = await checkoutToMockPage(page, reply, plans.cancelled);
    expect(again.id).not.toBe(cancelled.id);
    await page.getByRole("button", { name: "Decline at the test bank" }).click();
    await page.waitForURL(`${APP_ORIGIN}/billing/success?payment=${again.id}`);
    expect(failures).toEqual([]);
    expect(outside).toEqual([]);
    expectNoOutboundSince(mark);
  });

  test("a failed first attempt to open the payment page can be retried later", async ({
    context,
    page,
  }) => {
    test.setTimeout(180_000);
    const mark = readOutboundAttempts().length;
    const { outside, failures, reply } = await guard(context);
    // Arranged (trusted local step): the state a failed first attempt leaves.
    // The website's own two commands ran (the member's quote, the server's
    // claim) and then the provider call failed, so no request was stored.
    const session = await signIn(copy, member);
    const quote = await call(
      copy,
      "start_slot_checkout",
      {
        p_plan_id: plans.retry.id,
        p_slots: 1,
        p_expected_total_cents: Number(plans.retry.price_cents),
        p_cooling_off_consent: true,
      },
      session.token
    );
    const failedId = String(quote.payment_id);
    const claimed = await serviceRpc("claim_checkout_request", {
      p_payment_id: failedId,
      p_owner_id: member.id,
    });
    expect(claimed).toMatchObject({
      status: 200,
      data: { status: "pending", provider_request_id: null, checkout_url: null },
    });
    const failedKey = String(claimed.data.idempotency_key);
    expect(failedKey).toMatch(UUID);
    // 31 minutes later (the stored times move back; nothing else changes).
    queryTestCopy(
      "update private.payments set checkout_claim_until = checkout_claim_until - interval '31 minutes', " +
        "checkout_expires_at = checkout_expires_at - interval '31 minutes' " +
        `where id = '${failedId}' and status = 'pending' and provider_request_id is null;`
    );

    // The member tries again: the same payment, a fresh window and a new key.
    await signInBrowser(context, member);
    await page.goto(`/billing/checkout?plan=${plans.retry.id}`);
    await expect(page.getByRole("heading", { name: "Confirm your plan" })).toBeVisible();
    await tickCoolingOff(page);
    await page.getByRole("button", { name: /^Pay .+ securely$/ }).click();
    await expect.poll(() => reply("/api/billing/create-checkout").length).toBe(1);
    const [created] = reply("/api/billing/create-checkout");
    expect(created.status).toBe(200);
    await page.waitForURL((url) => url.origin === MOCK_PAYMENT_ORIGIN);
    const retriedId = (created.body as { paymentId: string }).paymentId;
    expect(retriedId).toBe(failedId);
    const [secondsLeft, key] = queryTestCopy(
      "select floor(extract(epoch from checkout_expires_at - now())), provider_idempotency_key " +
        `from private.payments where id = '${retriedId}';`
    ).split("|");
    expect(Number(secondsLeft)).toBeGreaterThan(25 * 60);
    expect(key).not.toBe(failedKey);
    expect(paymentRow(retriedId)).toMatchObject({
      status: "pending",
      request: `mock-${retriedId}`,
    });
    // Close it so it holds nothing for the later steps.
    await page.getByRole("button", { name: "Decline at the test bank" }).click();
    await page.waitForURL(`${APP_ORIGIN}/billing/success?payment=${retriedId}`);
    expect(failures).toEqual([]);
    expect(outside).toEqual([]);
    expectNoOutboundSince(mark);
  });

  test("the checkout total equals the pricing page for every package", async ({
    context,
    page,
  }) => {
    test.setTimeout(180_000);
    const mark = readOutboundAttempts().length;
    const { outside, failures, reply } = await guard(context);
    // Its own member, so its slots do not change the flows above.
    const buyer = await registerVerifiedMember("prices");
    await signInBrowser(context, buyer);
    const offers = [
      { tier: "month", plan: plans.business },
      { tier: "quarter", plan: plans.pending },
      { tier: "half_year", plan: plans.cancelled },
    ];
    for (const [index, { tier, plan }] of offers.entries()) {
      await page.goto("/pricing");
      const card = page.getByTestId(`retail-offer-${tier}`);
      const shown = (await card.getByTestId("retail-offer-price").textContent())?.trim();
      const rand = (cents: number) => `R${cents / 100}`;
      // The pricing page shows the database's price for one slot.
      expect(shown).toBe(rand(Number(plan.price_cents)));
      await card.getByRole("link", { name: /^Choose / }).click();
      await page.waitForURL((url) => url.pathname === "/billing/checkout");
      await expect(page.getByRole("heading", { name: "Confirm your plan" })).toBeVisible();
      await expect(page.getByTestId("checkout-total")).toHaveText(shown!);
      // Two slots: slot price x 2, the same total at the provider.
      await page.getByRole("button", { name: "One slot more" }).click();
      const total = Number(plan.price_cents) * 2;
      await expect(page.getByTestId("checkout-total")).toHaveText(rand(total));
      const before = reply("/api/billing/create-checkout").length;
      await tickCoolingOff(page);
      await page.getByRole("button", { name: `Pay ${rand(total)} securely` }).click();
      await page.waitForURL((url) => url.origin === MOCK_PAYMENT_ORIGIN);
      await expect(page.getByText(`Amount: R ${(total / 100).toFixed(2)}`)).toBeVisible();
      const created = reply("/api/billing/create-checkout").slice(before);
      expect(created).toEqual([expect.objectContaining({ status: 200 })]);
      const id = (created[0].body as { paymentId: string }).paymentId;
      expect(paymentRow(id)).toMatchObject({
        status: "pending",
        kind: "plan",
        amount: String(total),
      });
      expect(
        queryTestCopy(
          `select string_agg(amount_cents::text, ',' order by line_number) from private.payment_lines where payment_id = '${id}';`
        )
      ).toBe(`${plan.price_cents},${plan.price_cents}`);
      if (index < offers.length - 1) {
        await page.getByRole("button", { name: "Cancel at the test bank" }).click();
        await page.waitForURL(`${APP_ORIGIN}/billing/success?payment=${id}`);
        continue;
      }
      // The last one is paid: one payment, two slots, each on its own line.
      await page.getByRole("button", { name: "Pay with the test bank" }).click();
      await page.waitForURL(`${APP_ORIGIN}/billing/success?payment=${id}`);
      await expect(page.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();
      expect(paymentRow(id)).toMatchObject({ status: "complete", fulfilment: "fulfilled" });
      expect(entitlementsOf(id)).toEqual([
        "retail_paid|any|active|1|180|1",
        "retail_paid|any|active|1|180|2",
      ]);
      // My slots lists both, empty, with one purchase button for the page.
      await page.goto("/dashboard/slots");
      await expect(page.getByRole("heading", { name: "My slots" })).toBeVisible();
      await expect(page.getByTestId("my-slot")).toHaveCount(2);
      await expect(page.getByText("2 of 4 Individual slots")).toBeVisible();
      await expect(page.getByRole("link", { name: "Buy a slot" })).toBeVisible();
    }
    expect(failures).toEqual([]);
    expect(outside).toEqual([]);
    expectNoOutboundSince(mark);
  });

  test("a member whose ID review is not accepted is told why and cannot pay (M3.8)", async ({
    context,
    page,
  }) => {
    const mark = readOutboundAttempts().length;
    const { outside, failures } = await guard(context);
    const unreviewed = await registerUnreviewedMember("unreviewed");
    await signInBrowser(context, unreviewed);
    await page.goto(`/billing/checkout?plan=${plans.business.id}`);
    await expect(page.getByRole("heading", { name: "Confirm your plan" })).toBeVisible();
    await expect(page.getByTestId("slot-block-id_review")).toContainText(
      "Your ID review must be accepted before you buy a slot"
    );
    await expect(page.getByRole("link", { name: "Go to my ID review" })).toHaveAttribute(
      "href",
      "/verification"
    );
    await expect(page.getByRole("button", { name: /^Pay .+ securely$/ })).toBeDisabled();
    // The server says the same to a direct request, before any payment exists.
    const answered = await page.evaluate(async (planId) => {
      const token = document.cookie.match(/(?:^|; )vm_csrf=([a-f0-9]{64})/)?.[1] ?? "";
      const response = await fetch("/api/billing/create-checkout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "x-csrf-token": token },
        body: JSON.stringify({
          planId,
          slots: 1,
          expectedTotalCents: 6900,
          coolingOffConsent: true,
        }),
      });
      return { status: response.status, body: await response.json() };
    }, plans.business.id);
    expect(answered).toMatchObject({ status: 403, body: { code: "ID_REVIEW_REQUIRED" } });
    expect(
      queryTestCopy(`select count(*) from private.payments where owner_id = '${unreviewed.id}';`)
    ).toBe("0");
    expect(failures).toEqual([]);
    expect(outside).toEqual([]);
    expectNoOutboundSince(mark);
  });

  test("the Urgent add-on step says add-ons open soon and takes no payment", async ({
    context,
    page,
  }) => {
    const mark = readOutboundAttempts().length;
    const { outside, failures, reply } = await guard(context);
    await signInBrowser(context, member);
    const payments = () =>
      queryTestCopy(`select count(*) from private.payments where owner_id = '${member.id}';`);
    const before = {
      payments: payments(),
      made: ozow.made.length,
      notifications: ozow.notifications.length,
      lookups: ozow.lookups.length,
    };
    const logged = readServerLogEntries(ADDONS_PAUSED_LOG).length;

    // The restored button is unchanged: it is offered on the paid, live post.
    await page.goto("/dashboard/listings");
    const item = page
      .getByRole("listitem")
      .filter({ hasText: business.name })
      .filter({ has: page.getByRole("button", { name: URGENT_BUTTON }) });
    await expect(item).toHaveCount(1);
    await item.getByRole("button", { name: URGENT_BUTTON }).click();
    // It shows the server's refusal in its usual message, and stays on the page.
    await expect(page.getByText(ADDONS_PAUSED.error, { exact: true })).toBeVisible();
    await expect(page.getByText("Urgent failed", { exact: true })).toBeVisible();
    const path = `/api/businesses/${business.id}/urgent`;
    await expect.poll(() => reply(path).length).toBe(1);
    expect(reply(path)).toEqual([{ method: "POST", path, status: 403, body: ADDONS_PAUSED }]);
    expect(new URL(page.url()).pathname).toBe("/dashboard/listings");

    // Every other way to start an add-on for this post gives the same answer.
    const others = await page.evaluate(async (id) => {
      const token = document.cookie.match(/(?:^|; )vm_csrf=([a-f0-9]{64})/)?.[1] ?? "";
      const send = async (url: string, body?: unknown) => {
        const response = await fetch(url, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "x-csrf-token": token },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { url, status: response.status, body: await response.json() };
      };
      return [
        await send(`/api/businesses/${id}/boost`),
        await send(`/api/businesses/${id}/featured`),
        await send(`/api/listings/${id}/urgent`),
        await send(`/api/promotions/${id}/urgent`),
        await send("/api/foundation/billing/addon", { post_id: id, kind: "urgent", days: 7 }),
        await send("/api/foundation/billing/addon", { post_id: id, kind: "URGENT", days: 7 }),
      ];
    }, business.id);
    expect(others).toHaveLength(6);
    for (const answer of others) expect(answer).toMatchObject({ status: 403, body: ADDONS_PAUSED });
    // A plan checkout cannot carry an add-on either.
    const smuggled = await page.evaluate(
      async ({ planId, postId }) => {
        const token = document.cookie.match(/(?:^|; )vm_csrf=([a-f0-9]{64})/)?.[1] ?? "";
        const response = await fetch("/api/billing/create-checkout", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "x-csrf-token": token },
          body: JSON.stringify({ planId, post_id: postId, kind: "urgent" }),
        });
        return response.status;
      },
      { planId: urgent.id, postId: business.id }
    );
    expect(smuggled).toBe(400);

    // No payment was created and the payment provider was never asked.
    expect(payments()).toBe(before.payments);
    expect(ozow.made).toHaveLength(before.made);
    expect(ozow.notifications).toHaveLength(before.notifications);
    expect(ozow.lookups).toHaveLength(before.lookups);
    // The refusal logs at debug level only, which production's level drops,
    // so these requests added nothing to the server log; nor does it hold
    // the member's address, password or name.
    expect(readServerLogEntries(ADDONS_PAUSED_LOG)).toHaveLength(logged);
    expect(serverLogMentions([member.email, member.password, member.lastName])).toEqual([]);
    expect(failures).toEqual([]);
    expect(outside).toEqual([]);
    expectNoOutboundSince(mark);
  });

  test("the receipt email arrives with the payment details", async ({ request }) => {
    test.fail(true, PAY06);
    // Generous; characterise gives up 15 s before this limit (a test timeout
    // would count as the expected failure).
    test.setTimeout(180_000);
    await characterise(PAY06, async () => {
      const mark = readOutboundAttempts().length;
      const outboxId = queryTestCopy(
        "select id from private.outbox_events where kind = 'payment_completed' " +
          `and subject_id = '${planPayment.id}';`
      );
      expect(outboxId).toMatch(UUID);
      // Each run of the job sends at most one email, oldest first.
      for (let run = 0; run < 20 && !outboxState(outboxId).processed; run++)
        expect((await runOpsJob(request)).retrying).toBe(0);
      expect(outboxState(outboxId)).toEqual({ processed: true, attempts: 1, error: null });
      const mail = await caughtMailFor(member.email, `foundation-outbox/${outboxId}`);
      expect(mail.subject).toBe("Payment received");
      expectNoOutboundSince(mark);

      const [invoiceNumber, issued] = queryTestCopy(
        "select invoice_number, to_char(issued_at at time zone 'Africa/Johannesburg', 'YYYY-MM-DD') " +
          `from private.invoices where payment_id = '${planPayment.id}';`
      ).split("|");
      expect(invoiceNumber).toMatch(/^INV-\d{8}-[0-9A-F]{10}$/);
      const [year, month, day] = issued.split("-").map(Number);
      const monthName = new Date(Date.UTC(year, month - 1, 15)).toLocaleString("en-ZA", {
        month: "long",
        timeZone: "UTC",
      });
      // What a receipt shows (M3.7): amount, date, plan, the reference on the
      // bank statement (the provider reference field, 14 characters) and the
      // invoice number.
      const amount = (Number(plans.business.price_cents) / 100).toFixed(2);
      const shows = (...forms: string[]) => forms.some((form) => mail.text.includes(form));
      const wanted: Record<string, boolean> = {
        amount: shows(`R ${amount}`, `R${amount}`),
        date: shows(issued, `${day} ${monthName} ${year}`, `0${day} ${monthName} ${year}`),
        plan: shows(plans.business.label),
        "bank reference": shows(planPayment.merchantReference.slice(0, 14)),
        "invoice number": shows(invoiceNumber),
      };
      const missing = Object.keys(wanted).filter((name) => !wanted[name]);
      if (missing.length === Object.keys(wanted).length && RECEIPT_TODAY.test(mail.text)) {
        // PAY-06 as recorded: the email confirms only that a payment was
        // recorded and sends the member to Billing, which lists no invoices.
        throw new KnownBreak(
          `${PAY06}: "Payment received" has no ${missing.join(", ")} and points to Billing for the invoice`
        );
      }
      expect(missing).toEqual([]);
      expect(mail.text).not.toContain("invoice in Billing");
    });
  });

  test("a paid Urgent add-on shows its label to visitors", async ({ context, page }) => {
    test.fail(true, BL05);
    // Generous; characterise gives up 15 s before this limit (a test timeout
    // would count as the expected failure).
    test.setTimeout(180_000);
    await characterise(BL05, async () => {
      const mark = readOutboundAttempts().length;
      const { outside, failures } = await guard(context);
      // Arranged (trusted local steps): the website sells no add-on while
      // sales are paused, so the payment is set up as one started before the
      // pause: the member's own quote command, then the server's claim and its
      // mock checkout request, exactly what the website's checkout stores.
      const session = await signIn(copy, member);
      const quote = await call(
        copy,
        "start_checkout",
        { p_product_id: urgent.id, p_target_post: business.id },
        session.token
      );
      const addonId = String(quote.payment_id);
      const claimed = await serviceRpc("claim_checkout_request", {
        p_payment_id: addonId,
        p_owner_id: member.id,
      });
      expect(claimed).toMatchObject({
        status: 200,
        data: { status: "pending", product_kind: "addon", provider_request_id: null },
      });
      const checkout = new URL("/checkout", MOCK_PAYMENT_ORIGIN);
      checkout.searchParams.set("paymentId", addonId);
      checkout.searchParams.set("amount", (Number(urgent.price_cents) / 100).toFixed(2));
      checkout.searchParams.set("returnUrl", `${APP_ORIGIN}/billing/success?payment=${addonId}`);
      checkout.searchParams.set("cancelUrl", `${APP_ORIGIN}/billing/cancel?payment=${addonId}`);
      expect(
        await serviceRpc("complete_checkout_request", {
          p_payment_id: addonId,
          p_owner_id: member.id,
          p_claim_token: claimed.data.claim_token,
          p_request_id: `mock-${addonId}`,
          p_checkout_url: checkout.href,
        })
      ).toMatchObject({ status: 200, data: true });
      const addon = paymentOf(addonId);
      expect(paymentRow(addon.id)).toMatchObject({
        status: "pending",
        kind: "addon",
        amount: "1000",
        request: `mock-${addon.id}`,
      });

      // The member pays at the mock; the signed notice settles it through the
      // website's real notification route, paused sales or not.
      await signInBrowser(context, member);
      await page.goto(checkout.href);
      await expect(page.getByRole("heading", { name: "Mock Ozow test payment" })).toBeVisible();
      await page.getByRole("button", { name: "Pay with the test bank" }).click();
      await page.waitForURL(`${APP_ORIGIN}/billing/success?payment=${addon.id}`);
      await expect(page.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();
      expect(ozow.notifications.at(-1)).toMatchObject({
        paymentId: addon.id,
        status: 200,
        body: { result: { outcome: "completed", fulfillment_status: "fulfilled" } },
      });
      // Seven Urgent days on this post, paid by this payment.
      expect(
        queryTestCopy(
          "select kind, round(extract(epoch from ends_at - starts_at) / 86400), " +
            "starts_at <= now() and ends_at > now() from private.post_addon_windows " +
            `where post_id = '${business.id}' and payment_id = '${addon.id}' and revoked_at is null;`
        )
      ).toBe("urgent|7|t");

      // The owner sees it on My posts.
      await page.goto("/dashboard/listings");
      await expect(
        page
          .getByRole("listitem")
          .filter({ hasText: business.name })
          .getByRole("button", { name: "Already urgent" })
      ).toBeVisible();

      // Visitors: the post page.
      await context.clearCookies();
      await page.goto(`/mzansi-business/${business.id}`);
      await expect(page.getByText(business.name).filter({ visible: true }).first()).toBeVisible();
      const label = page.getByText("Urgent", { exact: true }).filter({ visible: true });
      if ((await label.count()) === 0) {
        // BL-05 as recorded: paid and active, shown to the owner, invisible to visitors.
        expect(failures).toEqual([]);
        expect(outside).toEqual([]);
        expectNoOutboundSince(mark);
        throw new KnownBreak(
          `${BL05}: the paid Urgent window is active and the owner sees "Already urgent", but the post page shows no Urgent label`
        );
      }
      await expect(label.first()).toBeVisible();
      // And on its card in search (the only result for its unique name).
      await page.goto(`/search?q=${encodeURIComponent(business.name)}`);
      await expect(
        page.getByRole("link", { name: business.name, exact: true }).first()
      ).toBeVisible();
      await expect(
        page.getByText("Urgent", { exact: true }).filter({ visible: true }).first()
      ).toBeVisible();
      expect(failures).toEqual([]);
      expect(outside).toEqual([]);
      expectNoOutboundSince(mark);
    });
  });

  test("the member deletes the post, which frees the plan's slot", async ({ context, page }) => {
    const mark = readOutboundAttempts().length;
    const { outside, failures, reply } = await guard(context);
    await signInBrowser(context, member);
    await page.goto("/dashboard/listings");
    const item = page
      .getByRole("listitem")
      .filter({ hasText: business.name })
      .filter({ has: page.getByRole("group", { name: "Promote this post" }) });
    await expect(item).toHaveCount(1);
    await item.getByRole("button", { name: "Delete", exact: true }).click();
    await item
      .getByRole("group", { name: "Delete this post?" })
      .getByRole("button", { name: "Yes, delete" })
      .click();
    await expect
      .poll(() => reply("/api/content/delete").map((entry) => entry.status))
      .toEqual([200]);
    expect(postExists(business.id)).toBe(false);
    // The plan's slot is free again for the rest of the plan.
    expect(
      queryTestCopy(
        "select count(*) from private.post_activations a " +
          "join private.entitlements e on e.id = a.entitlement_id " +
          `where e.payment_id = '${planPayment.id}' and a.released_at is null;`
      )
    ).toBe("0");
    expect(await allowance(page, "MZANSI_BUSINESS")).toMatchObject({
      status: 200,
      body: { used: 0, hasPaidPlan: true },
    });
    expect(failures).toEqual([]);
    expect(outside).toEqual([]);
    expectNoOutboundSince(mark);
  });
});
