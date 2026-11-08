import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { E2E_FIXTURE, LOCAL_OPS_JOBS_SECRET } from "../../scripts/lib/foundation-e2e-target.mjs";
import people from "./fixture/people.json";
import {
  browserSessionCookies,
  caughtMailFor,
  dueOutboxCount,
  enquiryCount,
  outboxState,
  queryTestCopy,
  queueMailCheckNotice,
  readTestCopy,
} from "./support/test-copy";

// Critical-flow test (M0.9a): a visitor's journey from the home showroom to
// contacting the seller, on the restored website in foundation mode against the
// private test copy. Browse the showroom, open a post from its card, reveal the
// seller's number (CAPTCHA in the site's own test mode), send an enquiry; the
// seller sees it in Leads, one run of the email job emails the seller, and the
// email lands in the copy's local mail catcher. The enquiry dialog posts to
// /api/contact, whose foundation branch sends it to api.submit_enquiry (M1.2).
//
// Browser HTTP(S) requests are checked against an allowlist: the copy's website
// and its local database gateway continue; anything else is aborted and fails
// the test. The CAPTCHA runs in the site's existing test mode (placeholder site
// key, bypass token accepted only outside production with PLAYWRIGHT_TEST_MODE),
// so no request leaves loopback. The website's emails go through the copy's
// local relay to the mail catcher (RESEND_BASE_URL, set only in the copy).

const APP_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.appPort}`;
const API_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.apiPort}`;
const POST_TITLE = "Fixture Soweto Craft Market";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// A service worker could fetch outside page routing; the allowlist must see every request.
test.use({ serviceWorkers: "block" });

type Captured = { status: number; request: unknown; body: unknown };

/** Lets only loopback requests to the copy through and records the contact
 * routes' requests and replies on their way through. */
async function guardAndCapture(context: BrowserContext) {
  const outside: string[] = [];
  const replies: Record<"reveal" | "contact", Captured[]> = { reveal: [], contact: [] };
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const captured =
      url.origin === APP_ORIGIN && request.method() === "POST"
        ? url.pathname === "/api/contact/reveal"
          ? replies.reveal
          : url.pathname === "/api/contact"
            ? replies.contact
            : null
        : null;
    if (captured) {
      const response = await route.fetch({ maxRedirects: 0 });
      const text = await response.text();
      captured.push({
        status: response.status(),
        request: JSON.parse(request.postData() ?? "null"),
        body: JSON.parse(text),
      });
      return route.fulfill({ response, body: text });
    }
    if (url.origin === APP_ORIGIN || url.origin === API_ORIGIN) return route.continue();
    outside.push(url.origin);
    return route.abort("blockedbyclient");
  });
  return { outside, replies };
}

/** Home showroom → the post's card → its page, as a visitor does it: the
 * carousel is moved with the keyboard until the card is in front, then the
 * front card is opened. */
async function openPostFromShowroom(page: Page, post: { id: string; title: string }) {
  await page.goto("/");
  const showroom = page.locator("section", { has: page.locator("#home-showroom-title") });
  // Attached, not necessarily exposed: with four cards the one opposite the
  // front is hidden (opacity 0) until the carousel turns towards it.
  await expect(showroom.locator(`a[aria-label="Open ${post.title}"]`)).toBeAttached();
  const slides = showroom.getByRole("group", { name: /^\d+ of \d+$/ });
  const count = await slides.count();
  const front = showroom.locator('[data-showroom-layer="active"] a[data-carousel-link="true"]');
  await showroom.getByLabel("Carousel slides").focus();
  for (let step = 0; step <= count; step++) {
    if ((await front.getAttribute("aria-label")) === `Open ${post.title}`) break;
    await page.keyboard.press("ArrowRight");
  }
  await expect(front).toHaveAttribute("aria-label", `Open ${post.title}`);
  await expect(front).toHaveAttribute("href", `/tourism-events/${post.id}`);
  await front.click();
  await page.waitForURL(`${APP_ORIGIN}/tourism-events/${post.id}`);
  await expect(page.getByText(post.title).filter({ visible: true }).first()).toBeVisible();
}

/** Runs the website's email job once, as the ops-jobs Worker does every minute. */
async function runEmailJob(request: APIRequestContext) {
  const response = await request.post("/api/webhooks/ops-jobs", {
    headers: { Authorization: `Bearer ${LOCAL_OPS_JOBS_SECRET}` },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as { claimed: number; succeeded: number; retrying: number };
}

// Read in beforeAll, never at import time: listing specs must not touch the copy.
let post: { id: string; title: string };
let sellerId: string;
let sellerPhone: string;

test.describe("showroom to contact the seller", () => {
  test.beforeAll(() => {
    const found = readTestCopy().posts.find((entry) => entry.title === POST_TITLE);
    if (!found) throw new Error(`The test copy has no post "${POST_TITLE}"`);
    post = found;
    // The seeded event offers a call and the enquiry form (fixture/posts.json).
    const [owner, channels] = queryTestCopy(
      "select p.owner_id, array_to_string(c.channels, ',') from private.posts p " +
        `join private.post_contacts c on c.post_id = p.id where p.id = '${post.id}';`
    ).split("|");
    expect(owner).toMatch(UUID);
    expect(channels).toBe("call,form");
    sellerId = owner;
    sellerPhone = queryTestCopy(
      "select phone from private.verification_phone_proofs " +
        `where owner_id = '${sellerId}' and revoked_at is null;`
    );
    expect(sellerPhone).toMatch(/^\+27[0-9]{9}$/);
  });

  test("a visitor opens a post from the home showroom and reveals the seller's number", async ({
    context,
    page,
  }) => {
    const { outside, replies } = await guardAndCapture(context);
    await openPostFromShowroom(page, post);

    // The number is not in the page until the visitor asks for it.
    await expect(page.locator(`a[href="tel:${sellerPhone}"]`)).toHaveCount(0);
    await page
      .getByRole("button", { name: "Show contact number" })
      .filter({ visible: true })
      .click();
    const call = page.getByRole("link", { name: `Call ${sellerPhone}` }).filter({ visible: true });
    await expect(call.first()).toHaveAttribute("href", `tel:${sellerPhone}`);

    // One reveal through the website's route, with the test-mode CAPTCHA token.
    expect(replies.reveal).toEqual([
      {
        status: 200,
        request: {
          targetType: "promotion",
          targetId: post.id,
          turnstileToken: "dev-turnstile-bypass",
        },
        body: { phone: sellerPhone, whatsapp: null, email: null },
      },
    ]);
    expect(outside).toEqual([]);
  });

  test("one run of the email job delivers a website notice to the seller's mail catcher inbox", async ({
    request,
  }) => {
    // A notice queued for the seller, then the job until that row is done
    // (each run handles at most one row; older rows go first).
    const id = queueMailCheckNotice(sellerId);
    for (let run = 0; run < 10 && !outboxState(id).processed; run++) {
      const summary = await runEmailJob(request);
      expect(summary.retrying).toBe(0);
    }
    expect(outboxState(id)).toEqual({ processed: true, attempts: 1, error: null });
    const mail = await caughtMailFor(people.verifiedMember.email, `foundation-outbox/${id}`);
    expect(mail.subject).toBe("Your introductory posting allowance is ready");
    // The website's own link rule: email links use the https address (production's
    // when the app address is not https), so only the path is checked here.
    expect(mail.text).toMatch(/^Sign in to view the details: https:\/\/\S+\/dashboard\s*$/m);
  });

  test("a visitor sends an enquiry; the seller sees it in Leads and receives an email", async ({
    context,
    page,
    request,
  }) => {
    const { outside, replies } = await guardAndCapture(context);
    // Nothing older waits in the email job, so the next run handles this enquiry.
    for (let run = 0; run < 10 && dueOutboxCount() > 0; run++) await runEmailJob(request);
    expect(dueOutboxCount()).toBe(0);
    const saved = enquiryCount(post.id);

    await openPostFromShowroom(page, post);
    await page.getByRole("button", { name: "Send an enquiry" }).filter({ visible: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Send a Message" })).toBeVisible();
    // A new reply address per run keeps reruns inside the database's flood
    // limits; the reference finds this run's enquiry among earlier ones.
    const reference = crypto.randomUUID().slice(0, 8);
    const buyerEmail = `visitor-${reference}@verifymzansi.test`;
    const message = `Hello, is the craft market open on Sunday mornings? Ref ${reference}`;
    await dialog.getByLabel("Your name").fill("Thabo Visitor");
    await dialog.getByLabel("Reply email").fill(buyerEmail);
    await dialog.getByLabel("Your message").fill(message);
    await dialog.getByRole("button", { name: "Send message" }).click();
    await expect.poll(() => replies.contact.length).toBe(1);
    const [reply] = replies.contact;
    expect(reply.request).toMatchObject({
      promotionId: post.id,
      buyerEmail,
      message,
      contactMethod: "form",
      turnstileToken: "dev-turnstile-bypass",
    });

    expect(reply).toMatchObject({ status: 200, body: { success: true } });
    await expect(dialog.getByText("Enquiry saved!")).toBeVisible();
    expect(enquiryCount(post.id)).toBe(saved + 1);
    const [enquiryId, outboxId] = queryTestCopy(
      "select e.id, o.id from private.enquiries e join private.outbox_events o " +
        "on o.kind = 'enquiry_received' and o.subject_id = e.id " +
        `where e.post_id = '${post.id}' and e.buyer_email = '${buyerEmail}';`
    ).split("|");
    expect(enquiryId).toMatch(UUID);
    expect(outboxId).toMatch(UUID);

    // The seller signs in and finds the enquiry in Leads.
    await context.clearCookies();
    const seller = await browserSessionCookies(readTestCopy(), "verifiedMember");
    expect(seller.accountId).toBe(sellerId);
    await context.addCookies(seller.cookies.map((cookie) => ({ ...cookie, url: APP_ORIGIN })));
    await page.goto("/dashboard/leads");
    const lead = page.getByRole("listitem").filter({ hasText: message });
    await expect(lead).toHaveCount(1);
    await expect(lead).toBeVisible();
    await expect(lead).toContainText("Thabo Visitor");
    await expect(lead).toContainText(`Re: ${post.title}`);

    // One run of the email job sends the seller's notice to the mail catcher.
    expect(await runEmailJob(request)).toEqual({ claimed: 1, succeeded: 1, retrying: 0 });
    expect(outboxState(outboxId)).toEqual({ processed: true, attempts: 1, error: null });
    const mail = await caughtMailFor(people.verifiedMember.email, `foundation-outbox/${outboxId}`);
    expect(mail.subject).toBe("New enquiry");
    expect(mail.text).toMatch(/^Sign in to view the details: https:\/\/\S+\/dashboard\/leads\s*$/m);
    expect(outside).toEqual([]);
  });
});
