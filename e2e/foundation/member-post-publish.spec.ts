import { randomBytes, randomInt, randomUUID } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import sharp from "sharp";
import { E2E_FIXTURE, LOCAL_OPS_JOBS_SECRET } from "../../scripts/lib/foundation-e2e-target.mjs";
import {
  browserSessionCookies,
  caughtMailFor,
  latestMailTo,
  mailCountTo,
  outboxState,
  queryTestCopy,
  readOutboundAttempts,
  readTestCopy,
  readTestSms,
  type Person,
} from "./support/test-copy";

// Critical-flow test (M0.9b): a member's journey on the restored website in
// foundation mode against the private test copy. A new person per run:
//   sign-up refused without an invitation (the launch setting), invited
//   sign-up through /register, email confirmation from the mail catcher, the
//   phone code read from the copy's SMS sink, ID and selfie photos, the area,
//   an admin's acceptance in the staff review, posting terms, opening a create
//   form, submitting, a moderator's approval, the post in the showroom and in
//   search, and the free week.
//
// Two steps are broken today and are marked test.fail(), each pinned to its
// exact known symptom (characterise below); any other outcome turns the run red:
// - "open the create form": BL-01, fixed by M1.1. The form's page check asks
//   the retired backend, so an accepted member is sent back to /verification.
// - "free week starts at approval": BL-03, fixed by M2.3. The every-minute job
//   starts the 7-day trial as soon as verification completes, before any post.
//
// Because the form cannot open, "submit, approve, showroom and search" sends
// the business post to the website route the form itself posts to
// (POST /api/businesses, from the member's browser with the page's CSRF
// token). Only the form's page is bypassed; the staff approval, showroom and
// search steps use the real pages. When M1.1 lands, that step should switch to
// the form. (On the copy the form page's posting-plan step shows the site's
// browser-test placeholder, not the member's real allowance.)
//
// Network: browser requests may only reach the copy's website and its local
// database gateway; anything else is aborted and fails the test. The website's
// own server runs behind the copy's outbound fence (serve preloads
// scripts/lib/foundation-e2e-outbound-preload.mjs): loopback passes, the
// password breach check is answered locally, anything else is refused and
// recorded. The phone code comes from the copy's SMS sink, which only the
// website's e2e SMS branch writes; the SMS provider is never contacted.
//
// The CAPTCHA: the site's test mode hands forms the bypass token, which the
// foundation sign-up refuses by design (production Auth verifies real tokens).
// The test therefore swaps that one token in the /register request for a
// stand-in token; the copy's local Auth has no CAPTCHA secret and accepts it,
// as hosted Auth accepts a real widget token. Nothing else in the request
// changes.

const APP_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.appPort}`;
const API_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.apiPort}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BL01 = "BL-01, fixed by M1.1";
const BL03 = "BL-03, fixed by M2.3";
const CAPTCHA_STAND_IN = "local-fixture-captcha-stand-in";
const SEVEN_DAYS_S = 7 * 86_400;
/** The staff identity viewer's three confirmations (foundation mode). */
const REVIEW_CHECKS = [
  "The ID number and legal name match the submitted details shown above, and the South African document is clear.",
  "The selfie and ID portrait appear to show the same person.",
  "I reviewed the liveness status and risk signals; the evidence is sufficient.",
];

// A service worker could fetch outside page routing; the allowlist must see every request.
test.use({ serviceWorkers: "block" });
test.describe.configure({ mode: "serial" });

type Reply = { method: string; path: string; status: number; body: unknown };

/** Lets only loopback requests to the copy through, records the website's API
 * replies, and swaps the CAPTCHA test-mode token on /register (see above). */
async function guard(context: BrowserContext) {
  const outside: string[] = [];
  const replies: Reply[] = [];
  const sent: string[] = [];
  const captchaTokens: unknown[] = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
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
    // Recorded when sent; a reply is recorded only once it arrives.
    sent.push(url.pathname);
    let postData: string | undefined;
    if (url.pathname === "/api/auth/register") {
      const body = JSON.parse(request.postData() ?? "{}");
      captchaTokens.push(body.turnstileToken);
      // Only the site's test-mode token is swapped; anything else goes as sent.
      if (body.turnstileToken === "dev-turnstile-bypass")
        postData = JSON.stringify({ ...body, turnstileToken: CAPTCHA_STAND_IN });
    }
    let response;
    let bytes: Buffer;
    try {
      response = await route.fetch({ maxRedirects: 0, ...(postData ? { postData } : {}) });
      bytes = await response.body();
    } catch (error) {
      // The test already ended (its page closed mid-request); nothing to record.
      if (/disposed|closed/i.test(String(error))) return;
      throw error;
    }
    // Binary replies (evidence images) are passed on untouched, never as text.
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
  const sentTo = (pathname: string) => sent.filter((entry) => entry === pathname).length;
  return { outside, replies, reply, sentTo, captchaTokens };
}

/** The camera is unavailable, so the photo steps offer their upload fallback,
 * exactly as on a device without a usable camera (today's capture rules). */
async function withoutCamera(context: BrowserContext) {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
  });
}

async function signInBrowser(context: BrowserContext, person: Person) {
  const session = await browserSessionCookies(readTestCopy(), person);
  await context.addCookies(session.cookies.map((cookie) => ({ ...cookie, url: APP_ORIGIN })));
  return session.accountId;
}

/** Runs the website's job route once, as the ops-jobs Worker does every minute
 * (post lifecycle, trial reconciliation and the other sweeps, then one email). */
async function runOpsJob(request: APIRequestContext) {
  const response = await request.post("/api/webhooks/ops-jobs", {
    headers: { Authorization: `Bearer ${LOCAL_OPS_JOBS_SECRET}` },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as { claimed: number; succeeded: number; retrying: number };
}

/** "Claim next 10" in a staff queue. A click that lands before the page is
 * interactive does nothing, so the click is repeated until the claim request
 * is sent (never once one was sent, even while its reply is slow: a second
 * claim would find nothing left and replace the page's message); the claim
 * must then succeed. */
async function claimQueue(page: Page, claims: () => Reply[], sent: () => number) {
  const button = page.getByRole("button", { name: "Claim next 10" });
  await expect(async () => {
    if (sent() === 0) await button.click();
    expect(sent()).toBeGreaterThan(0);
  }).toPass({ timeout: 30_000, intervals: [1_000, 2_000, 4_000] });
  await expect.poll(() => claims().map((entry) => entry.status)).toEqual([200]);
  await expect(page.getByText(/^You hold \d+ items? in this queue\.$/)).toBeVisible();
}

/** A synthetic photo: random noise over a flat colour, never a face or a
 * document, and different on every run (the risk check rejects reused photos). */
async function syntheticPhoto(width: number, height: number) {
  const noise = randomBytes(width * height * 3);
  return sharp(noise, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 70 })
    .toBuffer();
}

/** A valid synthetic South African ID number for an adult (Luhn checksum). */
function syntheticIdNumber() {
  const year = randomInt(70, 100);
  const month = randomInt(1, 13);
  const day = randomInt(1, 29);
  const digits =
    `${year}`.padStart(2, "0") +
    `${month}`.padStart(2, "0") +
    `${day}`.padStart(2, "0") +
    `${randomInt(0, 10_000)}`.padStart(4, "0") +
    "08";
  for (let check = 0; check < 10; check++) {
    const candidate = digits + check;
    let sum = 0;
    for (let i = 0; i < 13; i++) {
      let value = Number(candidate[12 - i]);
      if (i % 2 === 1) {
        value *= 2;
        if (value > 9) value -= 9;
      }
      sum += value;
    }
    if (sum % 10 === 0) return candidate;
  }
  throw new Error("No checksum digit");
}

/** Thrown only when the exact known symptom is observed. */
class KnownBreak extends Error {
  override name = "KnownBreak";
}

/**
 * Pins an expected failure to its known cause (as in showroom-contact.spec.ts).
 * While the test is marked test.fail(), only a KnownBreak may fail it; any other
 * failure is recorded and swallowed, so the test passes and Playwright reports
 * "expected to fail, but passed": the run turns red. The same happens when the
 * break is fixed but the mark is still there. Once the mark is removed, every
 * failure is reported as usual.
 */
async function characterise(note: string, body: () => Promise<void>) {
  const expectingFailure = test.info().expectedStatus === "failed";
  try {
    await body();
  } catch (error) {
    if (!expectingFailure || (error instanceof Error && error.name === "KnownBreak")) throw error;
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    test.info().annotations.push({ type: "not the known break", description: message });
    console.error(`[${note}] failed for another reason, so the run must turn red: ${message}`);
  }
}

const sql = (value: string) => {
  if (!/^[a-z0-9@.+-]+$/i.test(value)) throw new Error("Unexpected SQL literal");
  return `'${value}'`;
};

// One new person per run, made in beforeAll (never at import time).
let member: {
  ref: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
  idNumber: string;
  id?: string;
};
let business: { name: string; id?: string };

test.describe("member signs up, gets verified, posts and publishes", () => {
  test.beforeAll(() => {
    const ref = randomUUID().slice(0, 8);
    member = {
      ref,
      email: `member-${ref}@verifymzansi.test`,
      password: `Local-fixture-member-${ref}`,
      firstName: "Zanele",
      // Letters only (legal-name rules), unique per run so staff find this
      // member's case among earlier runs' cases.
      lastName: `Journey-${[...ref].map((c) => "abcdefghijklmnop"[parseInt(c, 16)]).join("")}`,
      phone: `+2772${randomInt(1_000_000, 10_000_000)}`,
      idNumber: syntheticIdNumber(),
    };
    business = { name: `Journey Studio ${ref}` };
  });

  test("at the launch setting, sign-up without an invitation is refused", async ({
    context,
    page,
  }) => {
    // Launch (OD-15: launch partners first): the website's registration switch
    // is on, as in production (FOUNDATION_REGISTRATION_ENABLED), and local
    // Auth runs the same invitation-only sign-up hook production uses
    // (internal.acceptance_signup_guard). Opening sign-up to everyone means
    // switching that hook off in hosted Auth; that is not the launch setting.
    const { outside, reply, captchaTokens } = await guard(context);
    const email = `uninvited-${member.ref}@verifymzansi.test`;
    await page.goto("/register");
    await page.getByLabel("First name").fill("Uninvited");
    await page.getByLabel("Last name").fill("Visitor");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("SA mobile number").fill("072 000 0000");
    await page.getByLabel("Password", { exact: true }).fill(`Local-fixture-refused-${member.ref}`);
    await page.getByLabel("Confirm password").fill(`Local-fixture-refused-${member.ref}`);
    await page.locator("#acceptTerms").check();
    await page.getByRole("button", { name: "Create account" }).click();
    await expect.poll(() => reply("/api/auth/register").length).toBe(1);
    // The hook's refusal reaches the visitor as the generic registration error.
    expect(reply("/api/auth/register")[0]).toMatchObject({
      status: 400,
      body: { error: "Check the registration details and complete the CAPTCHA" },
    });
    await expect(page.getByText("Registration failed").first()).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
    expect(captchaTokens).toEqual(["dev-turnstile-bypass"]);
    expect(queryTestCopy(`select count(*) from auth.users where email = ${sql(email)};`)).toBe("0");
    expect(await mailCountTo(email)).toBe(0);
    expect(outside).toEqual([]);
  });

  test("an invited person signs up, confirms the email and enters the phone code from the SMS sink", async ({
    context,
    page,
  }) => {
    test.setTimeout(120_000);
    const { outside, reply, captchaTokens } = await guard(context);
    // Trusted step (as an owner SQL session does in production): the invitation.
    queryTestCopy(
      `insert into private.owner_admin_invitations(email) values (${sql(member.email)});`
    );
    const sentAfter = Date.now() - 1000;
    await page.goto("/register");
    await page.getByLabel("First name").fill(member.firstName);
    await page.getByLabel("Last name").fill(member.lastName);
    await page.getByLabel("Email").fill(member.email);
    await page.getByLabel("SA mobile number").fill(member.phone.replace("+27", "0"));
    await page.getByLabel("Password", { exact: true }).fill(member.password);
    await page.getByLabel("Confirm password").fill(member.password);
    await page.locator("#acceptTerms").check();
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(`${APP_ORIGIN}/login?registered=true`);
    expect(captchaTokens).toEqual(["dev-turnstile-bypass"]);
    await expect
      .poll(() => reply("/api/auth/register"))
      .toEqual([
        expect.objectContaining({
          status: 200,
          body: {
            ok: true,
            message: "If registration is available for this email, check your inbox to continue.",
          },
        }),
      ]);
    // The password breach check ran, answered by the copy's fence (proving the
    // fence is loaded in the website's server).
    expect(readOutboundAttempts()).toContainEqual(
      expect.objectContaining({
        origin: "https://api.pwnedpasswords.com",
        outcome: "answered-locally",
      })
    );

    // Confirm from the mail catcher, in the same browser (it holds the PKCE verifier).
    const mail = await latestMailTo(member.email, { after: sentAfter });
    const link = mail.text.match(/http:\/\/127\.0\.0\.1:\d+\/auth\/v1\/verify\?[^\s)\]>"]+/)?.[0];
    expect(link, "confirmation link").toBeTruthy();
    const confirm = new URL((link as string).replaceAll("&amp;", "&"));
    expect(confirm.origin).toBe(API_ORIGIN);
    await page.goto(confirm.href);
    await page.waitForURL(`${APP_ORIGIN}/dashboard/complete-profile`);
    member.id = queryTestCopy(
      `select id from auth.users where email = ${sql(member.email)} and email_confirmed_at is not null;`
    );
    expect(member.id).toMatch(UUID);
    // Trusted step, as the seed does: close the invitation once it is used, so
    // this member can never claim it as an owner-admin invitation later.
    queryTestCopy(
      `update private.owner_admin_invitations set revoked_at = now() where email = ${sql(member.email)};`
    );

    // Phone code: sent by the website's e2e SMS branch to the copy's sink.
    await expect(page.getByRole("heading", { name: "Verify your phone number" })).toBeVisible();
    const smsBefore = readTestSms().length;
    await page.getByLabel("SA mobile number *").fill(member.phone.replace("+27", "0"));
    await page.getByRole("button", { name: "Send code" }).click();
    await expect.poll(() => readTestSms().length).toBe(smsBefore + 1);
    const sms = readTestSms().at(-1);
    expect(sms?.to).toBe(member.phone);
    const code = sms?.message.match(/code is: (\d{6})\./)?.[1];
    expect(code, "SMS code").toMatch(/^\d{6}$/);
    await expect
      .poll(() => reply("/api/otp/send"))
      .toEqual([expect.objectContaining({ status: 200 })]);
    await page.getByLabel("6-digit code").fill(code as string);
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(page.getByText("This phone number is verified.")).toBeVisible();
    await expect
      .poll(() => reply("/api/otp/verify"))
      .toEqual([expect.objectContaining({ status: 200 })]);
    expect(
      queryTestCopy(
        "select phone from private.verification_phone_proofs " +
          `where owner_id = '${member.id}' and revoked_at is null;`
      )
    ).toBe(member.phone);

    // Nothing left this machine: no browser request, and the website's server
    // tried no provider (its only off-machine request was the breach check,
    // answered by the fence).
    expect(outside).toEqual([]);
    expect(readOutboundAttempts().filter((entry) => entry.outcome !== "answered-locally")).toEqual(
      []
    );
  });

  test("the member adds ID and selfie photos and their area, then waits for review", async ({
    context,
    page,
  }) => {
    test.setTimeout(120_000);
    await withoutCamera(context);
    const { outside, reply } = await guard(context);
    await signInBrowser(context, member);
    await page.goto("/verification");

    // ID step: legal names, the ID number and a photo (upload fallback).
    await page.getByLabel("First name (as shown on ID)").fill(member.firstName);
    await page.getByLabel("Surname (as shown on ID)").fill(member.lastName);
    await page.getByLabel("13-digit SA ID number").fill(member.idNumber);
    await expect(page.getByText("ID number valid")).toBeVisible();
    await page.getByRole("button", { name: "Open camera" }).click();
    await page.getByLabel("Or upload a photo").setInputFiles({
      name: "id-front.jpg",
      mimeType: "image/jpeg",
      buffer: await syntheticPhoto(960, 600),
    });
    await page.getByRole("button", { name: "Continue" }).click();
    await expect.poll(() => reply("/api/verification/upload").length, { timeout: 30_000 }).toBe(1);

    // Selfie step: today's rules allow an upload when no camera is available.
    await expect(page.getByRole("heading", { name: "Live selfie" })).toBeVisible();
    await page.getByRole("button", { name: "Open camera" }).click();
    await page.getByLabel("Or upload a photo").setInputFiles({
      name: "selfie.jpg",
      mimeType: "image/jpeg",
      buffer: await syntheticPhoto(600, 800),
    });
    await page.getByRole("button", { name: "Continue" }).click();
    await expect.poll(() => reply("/api/verification/upload").length, { timeout: 30_000 }).toBe(2);
    expect(reply("/api/verification/upload").map((entry) => entry.status)).toEqual([200, 200]);

    // Area: detection is not available in foundation mode; pick it by hand.
    await page.getByRole("combobox", { name: "Province" }).selectOption("KwaZulu-Natal");
    await page.getByRole("combobox", { name: "City" }).selectOption("Richards Bay");
    await page.getByRole("button", { name: "Save location & finish" }).click();
    await expect(page.getByRole("heading", { name: "Verification submitted" })).toBeVisible();
    await expect
      .poll(() => reply("/api/verification/location/manual"))
      .toEqual([expect.objectContaining({ status: 200 })]);

    expect(
      queryTestCopy(
        "select count(*) from private.verification_identity_submissions " +
          `where owner_id = '${member.id}';`
      )
    ).toBe("1");
    expect(
      queryTestCopy(
        "select province_id || '/' || city_id from private.verification_localities " +
          `where owner_id = '${member.id}';`
      )
    ).toBe("kzn/kzn_richards_bay");
    expect(
      queryTestCopy(
        `select count(*) from private.accepted_identity_facts where owner_id = '${member.id}';`
      )
    ).toBe("0");
    expect(outside).toEqual([]);
  });

  test("an admin accepts the ID and selfie in the staff review", async ({
    context,
    page,
    request,
  }) => {
    test.setTimeout(150_000);
    const { outside, reply, sentTo } = await guard(context);
    await signInBrowser(context, "admin");
    const displayName = queryTestCopy(
      `select display_name from private.profiles where account_id = '${member.id}';`
    );
    expect(displayName.length).toBeGreaterThan(1);

    await page.goto("/admin/verification");
    await claimQueue(
      page,
      () => reply("/api/admin/queue"),
      () => sentTo("/api/admin/queue")
    );
    // This member's case: the nearest block around their name that holds the
    // review buttons (one per account in the queue).
    const card = page
      .getByText(displayName, { exact: true })
      .locator('xpath=ancestor::div[.//button[normalize-space(.)="Review"]][1]');
    await expect(card).toHaveCount(1);

    for (const step of ["ID", "selfie"] as const) {
      await card.getByRole("button", { name: "Review", exact: true }).first().click();
      const viewer = page.getByRole("dialog", { name: /^Identity Comparison/ });
      await expect(viewer).toBeVisible();
      // The reviewer confirms the three checks the viewer asks for.
      for (const check of REVIEW_CHECKS) await viewer.getByLabel(check).check();
      const approve = viewer.getByRole("button", { name: `Approve ${step}` });
      await expect(approve).toBeEnabled({ timeout: 20_000 });
      await approve.click();
      const confirm = page.getByRole("dialog", { name: "Approve Verification Step" });
      await confirm.getByRole("button", { name: "Confirm Approve" }).click();
      await expect
        .poll(() => reply("/api/admin/verification/decide").length)
        .toBe(step === "ID" ? 1 : 2);
      await expect(confirm).toBeHidden();
      if (await viewer.isVisible()) await page.keyboard.press("Escape");
    }
    expect(
      reply("/api/admin/verification/decide").map(
        (entry) => (entry.body as { status?: string }).status
      )
    ).toEqual(["step_approved", "accepted"]);
    expect(
      queryTestCopy(
        "select count(*) from private.accepted_identity_facts " +
          `where owner_id = '${member.id}' and revoked_at is null;`
      )
    ).toBe("1");

    // The every-minute job delivers the member's "identity accepted" email.
    const outboxId = queryTestCopy(
      "select id from private.outbox_events where kind = 'identity_accepted' " +
        `and owner_id = '${member.id}';`
    );
    expect(outboxId).toMatch(UUID);
    for (let run = 0; run < 15 && !outboxState(outboxId).processed; run++) {
      expect((await runOpsJob(request)).retrying).toBe(0);
    }
    expect(outboxState(outboxId)).toEqual({ processed: true, attempts: 1, error: null });
    const mail = await caughtMailFor(member.email, `foundation-outbox/${outboxId}`);
    expect(mail.subject).toBe("Identity review completed");
    expect(outside).toEqual([]);
  });

  test("the member is shown as verified and accepts the posting terms", async ({
    context,
    page,
  }) => {
    const { outside, reply } = await guard(context);
    await signInBrowser(context, member);
    await page.goto("/verification");
    await expect(page.getByRole("heading", { name: "Verification approved" })).toBeVisible();
    await page.goto("/post/create");
    await page.getByRole("checkbox", { name: "I agree to the current posting terms." }).check();
    await page.getByRole("button", { name: "Accept posting terms" }).click();
    // Once accepted, the gate gives way to the section chooser.
    await expect(page.getByRole("heading", { name: "What would you like to post?" })).toBeVisible();
    await expect
      .poll(() => reply("/api/foundation/posting-terms"))
      .toEqual([expect.objectContaining({ status: 200 })]);
    expect(
      queryTestCopy(
        `select count(*) from private.posting_terms_acceptances where owner_id = '${member.id}';`
      )
    ).toBe("1");
    expect(outside).toEqual([]);
  });

  test("open the create form", async ({ context, page }) => {
    test.fail(true, BL01);
    await characterise(BL01, async () => {
      const { outside } = await guard(context);
      await signInBrowser(context, member);
      await page.goto("/post/create-business");
      // The page streams, so a redirect from its layout happens in the browser
      // after the first bytes: wait until either the form page or /verification shows.
      // The form page opens with its posting-plan step, then the form itself.
      const form = page
        .getByRole("heading", { name: "Choose how you want to post" })
        .or(page.getByText("Add your business"))
        .first();
      await Promise.race([
        page.waitForURL((url) => url.pathname === "/verification", { timeout: 20_000 }),
        form.waitFor({ timeout: 20_000 }),
      ]).catch(() => undefined);
      const landed = new URL(page.url());
      if (landed.pathname === "/verification") {
        // BL-01 as recorded: the form's page check reads the retired backend,
        // finds nothing and sends an accepted member to /verification, which
        // shows them as approved and links straight back to the form.
        expect(landed.searchParams.get("returnUrl")).toBe("/post/create-business");
        expect(
          queryTestCopy(
            "select count(*) from private.accepted_identity_facts " +
              `where owner_id = '${member.id}' and revoked_at is null;`
          )
        ).toBe("1");
        // The page loads the status after its first paint; allow a slow machine.
        await expect(page.getByRole("heading", { name: "Verification approved" })).toBeVisible({
          timeout: 20_000,
        });
        await expect(page.getByRole("link", { name: "Return to posting" })).toHaveAttribute(
          "href",
          "/post/create-business"
        );
        expect(outside).toEqual([]);
        throw new KnownBreak(
          `${BL01}: /post/create-business sent an accepted member to /verification`
        );
      }
      expect(landed.pathname).toBe("/post/create-business");
      await expect(form).toBeVisible();
      expect(outside).toEqual([]);
    });
  });

  test("submit, approve, showroom and search (the form's own route; the form page is bypassed)", async ({
    browser,
    context,
    page,
  }) => {
    test.setTimeout(150_000);
    const { outside, reply } = await guard(context);
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
            description: "Hand-made studio prints and frames, ordered online and delivered.",
            location_province: "KwaZulu-Natal",
            location_city: "Richards Bay",
            contact_methods: ["form"],
            category_details: {
              customer_access: { version: 2, methods: ["online"], publishAddress: false },
            },
            trialDays: 7,
            termsAccepted: true,
          }),
        });
        return { status: response.status, body: await response.json() };
      },
      { name: business.name, slug: `journey-studio-${member.ref}` }
    );
    expect(submitted).toMatchObject({
      status: 200,
      body: { success: true, pendingReview: true, status: "pending_moderation" },
    });
    business.id = (submitted.body as { id: string }).id;
    expect(business.id).toMatch(UUID);

    // A moderator approves it in the staff moderation queue.
    const staff = await browser.newContext({ serviceWorkers: "block" });
    try {
      const moderation = await guard(staff);
      await signInBrowser(staff, "moderator");
      const staffPage = await staff.newPage();
      await staffPage.goto("/admin/moderation");
      await claimQueue(
        staffPage,
        () => moderation.reply("/api/admin/queue"),
        () => moderation.sentTo("/api/admin/queue")
      );
      const item = staffPage
        .locator("div")
        .filter({ hasText: business.name })
        .filter({ has: staffPage.getByRole("button", { name: "Approve" }) })
        .last();
      await item.getByRole("button", { name: "Approve" }).click();
      const dialog = staffPage.getByRole("dialog", { name: "Approve Content" });
      await dialog.getByRole("button", { name: "Publish" }).click();
      await expect.poll(() => moderation.reply("/api/admin/content/decide").length).toBe(1);
      expect(moderation.reply("/api/admin/content/decide")[0].status).toBe(200);
      expect(moderation.outside).toEqual([]);
    } finally {
      await staff.close();
    }
    expect(queryTestCopy(`select status from private.posts where id = '${business.id}';`)).toBe(
      "live"
    );

    // Visible to everyone: in the home showroom data and in search.
    await context.clearCookies();
    await page.goto("/");
    await expect(page.locator(`a[href="/mzansi-business/${business.id}"]`).first()).toBeAttached();
    await page.goto(`/search?q=${encodeURIComponent(business.name)}`);
    const result = page.getByRole("link", { name: business.name, exact: true }).first();
    await expect(result).toBeVisible();
    await result.click();
    await page.waitForURL(`${APP_ORIGIN}/mzansi-business/${business.id}`);
    await expect(page.getByText(business.name).filter({ visible: true }).first()).toBeVisible();
    await expect
      .poll(() => reply("/api/businesses"))
      .toEqual([expect.objectContaining({ status: 200 })]);
    expect(outside).toEqual([]);
  });

  test("free week starts at approval", async ({ context, page }) => {
    test.fail(true, BL03);
    await characterise(BL03, async () => {
      const { outside } = await guard(context);
      const trials = queryTestCopy(
        "select extract(epoch from e.starts_at)::bigint, extract(epoch from e.ends_at - e.starts_at)::bigint " +
          "from private.entitlements e " +
          `where e.owner_id = '${member.id}' and e.source = 'intro_trial' and e.status = 'active';`
      )
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split("|").map(Number));
      const [submittedAt, publishedAt] = queryTestCopy(
        "select extract(epoch from submitted_at)::bigint, extract(epoch from published_at)::bigint " +
          `from private.posts where id = '${business.id}';`
      )
        .split("|")
        .map(Number);
      const acceptedAt = Number(
        queryTestCopy(
          "select extract(epoch from reviewed_at)::bigint from private.accepted_identity_facts " +
            `where owner_id = '${member.id}' and revoked_at is null;`
        )
      );
      expect(trials).toHaveLength(1);
      const [[startsAt, length]] = trials;
      if (startsAt < submittedAt && startsAt >= acceptedAt && length === SEVEN_DAYS_S) {
        // BL-03 as recorded: the 7-day trial began when verification completed
        // (the job's reconciliation), before the member had posted anything,
        // so review and moderation time came out of the free week.
        throw new KnownBreak(
          `${BL03}: the trial started ${submittedAt - startsAt} s before the post was submitted`
        );
      }
      // Promised: the free week starts when the first post is approved and the
      // member sees its end date on the dashboard.
      expect(Math.abs(startsAt - publishedAt)).toBeLessThanOrEqual(120);
      expect(length).toBe(SEVEN_DAYS_S);
      await signInBrowser(context, member);
      await page.goto("/dashboard");
      const card = page.getByRole("region", { name: "Free posts and trials" });
      await expect(card).toContainText("Visible until");
      expect(outside).toEqual([]);
    });
  });
});
