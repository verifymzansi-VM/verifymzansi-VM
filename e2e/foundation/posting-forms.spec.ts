import path from "node:path";
import { expect, test, type Locator, type Page, type Response } from "@playwright/test";
import { E2E_FIXTURE } from "../../scripts/lib/foundation-e2e-target.mjs";
import { eventDateInput } from "../event-dates";
import {
  browserSessionCookies,
  queryTestCopy,
  readTestCopy,
  rpc,
  signIn,
  type TestCopy,
} from "./support/test-copy";
import { registerVerifiedMember, type VerifiedMember } from "./support/verified-member";

// A verified member fills in and submits each create form through the
// restored website's own steps (listing, business, tourism stay, event), then
// edits a submitted post through its edit form. Foundation mode against the
// private test copy; the database rows are read back from the copy. Moved from
// the stub suite's posting.chromium, posting-journeys and posting-guidance
// specs, which ran on an in-memory stand-in.
//
// The posting-plan step: in the copy's test mode the plan gate offers the free
// placeholder plan, so the member reaches the form without paying. What the
// member may publish is decided later, at approval (not tested here).

const APP_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.appPort}`;
const IMAGE_FIXTURE = path.join(process.cwd(), "src", "app", "icon.png");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

// A new verified member per test: a member's free week funds one post, so a
// second form would be refused for the allowance, not tested.
let member: VerifiedMember;
let ref = "";
test.beforeAll(async ({ browserName }, testInfo) => {
  test.skip(
    browserName !== "chromium" || testInfo.project.name !== "chromium",
    "Desktop posting flows run once, in the chromium project."
  );
});

test.beforeEach(async ({ context }) => {
  member = await registerVerifiedMember("posting");
  ref = member.id.slice(0, 6);
  const session = await browserSessionCookies(readTestCopy(), member);
  await context.addCookies(session.cookies.map((cookie) => ({ ...cookie, url: APP_ORIGIN })));
});

/** The member's post with this title, read from the copy. */
function savedPost(title: string) {
  const row = queryTestCopy(
    `select id, kind, area, status from private.posts where owner_id = '${member.id}' and title = '${title.replace(/'/g, "''")}';`
  );
  const [id, kind, area, status] = row.split("|");
  return { id, kind, area, status };
}

/** A moderator approves the post through the production commands (the staff
 * screens have their own spec), as checkout-fulfilment.spec.ts does. */
async function approve(postId: string) {
  const copy: TestCopy = readTestCopy();
  const call = async (name: string, body: unknown, token: string) => {
    const result = await rpc(copy, name, body, token);
    if (result.status !== 200) throw new Error(`Command ${name} answered ${result.status}`);
    return result.data;
  };
  const moderator = await signIn(copy, "moderator");
  const revision = Number(
    queryTestCopy(`select revision from private.posts where id = '${postId}';`)
  );
  const lease = await call(
    "claim_queue_item",
    { p_subject: "post", p_id: postId },
    moderator.token
  );
  await call(
    "moderate_post",
    {
      p_post_id: postId,
      p_expected_revision: revision,
      p_decision: "approve",
      p_reason: null,
      p_claim_generation: lease.claim_generation,
      p_claim_nonce: lease.claim_nonce,
    },
    moderator.token
  );
}

function uploaderFor(page: Page, label: RegExp) {
  return page
    .getByText(label)
    .first()
    .locator("xpath=ancestor::*[.//input[@type='file']][1]")
    .locator("input[type='file']")
    .first();
}

/** Opens a create form and waits until it has loaded the posting terms it
 * sends with the post (the form refuses to submit before that). */
async function openForm(page: Page, route: string, firstField: Locator) {
  const terms = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/foundation/posting-terms",
    { timeout: 45_000 }
  );
  await page.goto(route);
  await enterPostingForm(page, firstField);
  expect((await terms).status()).toBe(200);
}

async function enterPostingForm(page: Page, firstField: Locator) {
  const start = page.getByRole("button", { name: /Start Posting|Use Your Free Post/i });
  await Promise.race([
    firstField.waitFor({ state: "visible", timeout: 15_000 }),
    start.waitFor({ state: "visible", timeout: 15_000 }),
  ]).catch(() => undefined);
  if (await start.isVisible().catch(() => false)) await start.click();
  await firstField.waitFor({ state: "visible", timeout: 15_000 });
}

/** Ticks the posting-terms box when the form shows it (accepted terms may hide it). */
async function acceptTermsIfShown(page: Page) {
  const box = page.getByRole("checkbox", { name: /I accept the VerifyMzansi posting terms/i });
  if (await box.isVisible().catch(() => false)) await box.check();
}

async function submitFor(page: Page, apiPath: string, method = "POST") {
  const answered = page.waitForResponse(
    (response: Response) =>
      new URL(response.url()).pathname === apiPath && response.request().method() === method,
    { timeout: 45_000 }
  );
  await page.getByRole("button", { name: /Submit for review/i }).click();
  const response = await answered;
  // Chromium can detach the body once the form navigates away, so read it
  // only for a refusal (the form then stays on the page).
  if (response.status() >= 300)
    throw new Error(`${method} ${apiPath} answered ${response.status()}: ${await response.text()}`);
  return response;
}

test("the first step refuses to move on while required fields are empty", async ({ page }) => {
  for (const [route, first] of [
    ["/post/create-listing", page.getByRole("button", { name: /Electronics\s*&\s*Tech/i })],
    ["/post/create-business", page.getByLabel(/^Business Name/)],
  ] as const) {
    await page.goto(route);
    await enterPostingForm(page, first.first());
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText(/Please fix\s+\d+\s+field/i).first()).toBeVisible();
    await expect(page.getByText(/Step 1 of/i).first()).toBeVisible();
  }
});

test("a market listing is submitted through its form, then edited", async ({ page }) => {
  const title = `Foundation form phone ${ref}`;
  const category = page.getByRole("button", { name: /Electronics\s*&\s*Tech/i }).first();
  await openForm(page, "/post/create-listing", category);
  await category.click();
  await page.locator('[data-listing-attribute="device_type"]').selectOption("Smartphone");
  await page.locator('[data-listing-attribute="brand"]').fill("Apple");
  await page.getByLabel(/^Title/).fill(title);
  await page
    .getByLabel(/^Description/)
    .fill("A synthetic phone listing with enough detail to satisfy the validation rules.");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel(/^Asking price/i).fill("18500");
  await page.getByLabel(/^Province/i).selectOption("Gauteng");
  await page.getByLabel(/^City/i).selectOption("Johannesburg");
  await page.getByLabel(/^Town \/ Suburb/i).fill("Sandton");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await uploaderFor(page, /^Photos \(max/i).setInputFiles(IMAGE_FIXTURE);
  await acceptTermsIfShown(page);
  await submitFor(page, "/api/listings");
  await expect(page).toHaveURL(/\/dashboard\/listings/, { timeout: 30_000 });

  const saved = savedPost(title);
  expect(saved.id).toMatch(UUID);
  expect(saved).toMatchObject({ kind: "listing", area: "market" });
  expect(saved.status).not.toBe("live");

  // A post waiting for review cannot be edited (foundation rule); once a
  // moderator approves it, an edit goes back to review while the live post
  // keeps showing the approved version.
  await approve(saved.id);
  expect(savedPost(title).status).toBe("live");
  const edited = `Foundation form phone edited ${ref}`;
  await page.goto(`/post/edit-listing/${saved.id}`);
  await expect(page.getByLabel(/^Title/)).toHaveValue(title, { timeout: 20_000 });
  await page.getByLabel(/^Title/).fill(edited);
  const update = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/listings/${saved.id}` &&
      response.request().method() === "PUT",
    { timeout: 45_000 }
  );
  await page.getByRole("button", { name: /Save Changes/i }).click();
  expect((await update).status()).toBeLessThan(300);
  await expect(page).toHaveURL(/\/dashboard\/listings/, { timeout: 30_000 });
  expect(savedPost(title)).toMatchObject({ id: saved.id, status: "live" });
  expect(
    queryTestCopy(
      `select status from private.posts where edit_of = '${saved.id}' and title = '${edited}';`
    )
  ).toBe("pending_moderation");
});

test("a business is submitted through its form", async ({ page }) => {
  const name = `Foundation Form Studio ${ref}`;
  const nameField = page.getByLabel(/^Business Name/);
  await openForm(page, "/post/create-business", nameField);
  await nameField.fill(name);
  await page
    .getByLabel(/^About Your Business/)
    .fill("A synthetic studio business with enough detail to satisfy validation rules.");
  await page.getByRole("button", { name: /^Clothing/ }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("checkbox", { name: "Customers visit me", exact: true }).check();
  await page.getByLabel(/^Where do customers visit you/).selectOption("standalone_shop");
  await page.getByLabel("Province", { exact: true }).selectOption("Gauteng");
  await page.getByLabel("City or town", { exact: true }).selectOption("Johannesburg");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("checkbox", { name: "Email", exact: true }).check();
  await page.getByLabel(/^Email Address/).fill("studio@example.com");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await uploaderFor(page, /^Profile photos/i).setInputFiles(IMAGE_FIXTURE);
  await acceptTermsIfShown(page);
  await submitFor(page, "/api/businesses");
  await expect(page).toHaveURL(/\/dashboard\/(?:listings|businesses)/, { timeout: 30_000 });
  const saved = savedPost(name);
  expect(saved.id).toMatch(UUID);
  expect(saved.kind).toBe("business");
  expect(saved.status).not.toBe("live");
});

test("an event is submitted through its form", async ({ page }) => {
  const title = `Foundation Form Evening ${ref}`;
  const titleField = page.getByLabel(/^Event name/);
  await openForm(page, "/post/create-tourism?type=event", titleField);
  await titleField.fill(title);
  await page.getByLabel(/^Event category/).selectOption({ index: 1 });
  await page
    .getByLabel(/^Description/)
    .fill("A synthetic evening event with enough detail to satisfy the validation rules.");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel(/^Start date/).fill(eventDateInput());
  await page.getByLabel(/^Start time/).fill("18:00");
  await page.getByLabel("Free entry").check();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel(/^Province/i).selectOption("Gauteng");
  await page.getByLabel(/^City/i).selectOption("Johannesburg");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await uploaderFor(page, /^Upload photos/i).setInputFiles(IMAGE_FIXTURE);
  await acceptTermsIfShown(page);
  await submitFor(page, "/api/promotions");
  await expect(page).toHaveURL(/\/dashboard\/(?:listings|promotions|tourism-events)/, {
    timeout: 30_000,
  });
  const saved = savedPost(title);
  expect(saved.id).toMatch(UUID);
  expect(saved.kind).toBe("event");
});

test("a tourism stay is submitted through its form", async ({ page }) => {
  const name = `Foundation Form Lodge ${ref}`;
  const nameField = page.getByLabel(/^Business Name|^Listing name/).first();
  await openForm(page, "/post/create-tourism?type=tourism_business", nameField);
  await nameField.fill(name);
  await page.locator("select#subcategory").selectOption("guest_house_bnb");
  await page
    .getByLabel(/^Description/)
    .first()
    .fill("A synthetic guest lodge with enough detail to satisfy the validation rules.");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  // Visitor details are optional for a guest house.
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Province", { exact: true }).selectOption("Gauteng");
  await page.getByLabel("City or town", { exact: true }).selectOption("Johannesburg");
  await page.getByLabel("Town / Suburb").fill("Melville");
  await page.getByLabel("Detailed address").fill("12 Synthetic Street");
  // Contact through the website's form instead of a phone number.
  await page.getByRole("checkbox", { name: "Phone Call" }).uncheck();
  await page.getByRole("checkbox", { name: "Contact Form" }).check();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await uploaderFor(page, /^Upload photos/i).setInputFiles(IMAGE_FIXTURE);
  await acceptTermsIfShown(page);
  await submitFor(page, "/api/businesses");
  await expect(page).toHaveURL(/\/dashboard\//, { timeout: 30_000 });
  const saved = savedPost(name);
  expect(saved.id).toMatch(UUID);
  expect(saved).toMatchObject({ kind: "business", area: "tourism_events" });
  expect(saved.status).not.toBe("live");
});
