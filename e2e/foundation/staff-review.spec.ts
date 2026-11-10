import { randomBytes, randomUUID } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import sharp from "sharp";
import { E2E_FIXTURE, LOCAL_OPS_JOBS_SECRET } from "../../scripts/lib/foundation-e2e-target.mjs";
import { characterise, KnownBreak, requireOnlyKnownBreak } from "./support/known-break";
import { endedWithTest } from "./support/route-teardown";
import {
  browserSessionCookies,
  queryTestCopy,
  readOutboundAttempts,
  readTestCopy,
  rpc,
  serviceRpc,
  signIn,
  type Person,
  type SessionOptions,
  type TestCopy,
} from "./support/test-copy";
import {
  acceptPostingTerms,
  registerUnreviewedMember,
  registerVerifiedMember,
  syntheticIdNumber,
  type VerifiedMember,
} from "./support/verified-member";

// Critical-flow test (M0.9d): staff work on the restored website in foundation
// mode against the private test copy, each staff person with an authenticator
// app. Two new members per run send their ID and selfie photos through the
// website, and a third (verified through the production commands, as in
// checkout-fulfilment.spec.ts) owns a post that stays waiting for review; then:
//   - a staff action without a fresh authenticator code is refused (no code
//     yet, a code older than 12 hours, and a code older than 15 minutes for a
//     sensitive action), in the database and on the staff pages;
//   - an admin sends one member's ID back with a reason and accepts the other
//     member's ID and selfie in the identity review;
//   - a moderator approves a post in the moderation queue;
//   - a report filed by the moderator can never be worked by the moderator
//     (staff cannot review themselves), and an admin decides it;
//   - an admin cannot review their own identity case;
//   - an admin verifies, approves and completes a member's privacy request.
//
// Three steps are broken today and are marked test.fail(), each pinned to its
// exact known symptom (characterise, support/known-break.ts); any other
// outcome turns the run red:
// - "the member whose ID was sent back is told why and notified": BL-12,
//   fixed by M2.7. The verification page shows generic text instead of the
//   reviewer's reason, and no email or notice is queued.
// - "the per-section review queue lists the waiting post": D3B-02, fixed by
//   M6.3. The section page reads the retired backend for its content queue.
// - "the operations page shows job health": D5-02, fixed by M5.5. The page
//   reads retired tables and functions.
// The tests share the members and run in order; a failure skips the rest, so
// the marked steps come last.
//
// Network: browser requests may only reach the copy's website and its local
// database gateway (anything else is aborted and fails the test), and the
// website's own server runs behind the copy's outbound fence, whose log must
// show no new request at all (no staff step talks to a provider).
//
// The members' posts go to the website route the create form posts to
// (POST /api/businesses, as in member-post-publish.spec.ts: the form page
// cannot open until M1.1). The member's privacy request is recorded with the
// production command the /dsar route calls after its CAPTCHA check (see that
// test). Everything the spec publishes is deleted at the end (the copy's
// showroom and staff queues are shared with the other specs).

const APP_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.appPort}`;
const API_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.apiPort}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BL12 = "BL-12, fixed by M2.7";
const D3B02 = "D3B-02, fixed by M6.3";
const D502 = "D5-02, fixed by M5.5";
const TWO_STEP_PATH = "/staff/two-step";
/** The identity viewer's three confirmations (foundation mode). */
const REVIEW_CHECKS = [
  "The ID number and legal name match the submitted details shown above, and the South African document is clear.",
  "The selfie and ID portrait appear to show the same person.",
  "I reviewed the liveness status and risk signals; the evidence is sufficient.",
];
/** The "Glare or blur" retake request the identity review offers. */
const RETAKE_NOTE =
  "Please retake your photo in even light without glare. Keep the camera steady and make sure the details are sharp.";
/** Today's generic text on the verification page for an ID that was sent back. */
const GENERIC_ID_RETURN =
  "Your ID document was not accepted. Upload a clear photo showing the full document and all details.";

// A service worker could fetch outside page routing; the allowlist must see every request.
test.use({ serviceWorkers: "block" });
test.describe.configure({ mode: "serial" });

type Reply = { method: string; path: string; status: number; body: unknown };

/** Lets only the copy's website and its gateway through and records the
 * website's API replies (POST, PATCH, DELETE). */
async function guard(context: BrowserContext) {
  const outside: string[] = [];
  const failures: string[] = [];
  const replies: Reply[] = [];
  const sent: string[] = [];
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
    sent.push(url.pathname);
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
  const sentTo = (pathname: string) => sent.filter((entry) => entry === pathname).length;
  return { outside, failures, reply, sentTo };
}

/** The website's server tried nothing off this machine since `mark` (the
 * copy's outbound fence records every such attempt, by origin). */
function expectNoOutboundSince(mark: number) {
  expect(readOutboundAttempts().slice(mark)).toEqual([]);
}

async function signInBrowser(
  context: BrowserContext,
  person: Person,
  options: SessionOptions = {}
) {
  const session = await browserSessionCookies(readTestCopy(), person, options);
  await context.addCookies(session.cookies.map((cookie) => ({ ...cookie, url: APP_ORIGIN })));
  return session.accountId;
}

/** A second person's browser in the same test, behind the same allowlist. */
async function otherBrowser(browser: Browser, person: Person, options: SessionOptions = {}) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const guarded = await guard(context);
  await signInBrowser(context, person, options);
  return { context, page: await context.newPage(), ...guarded };
}

/** The camera is unavailable, so the photo steps offer their upload fallback,
 * exactly as on a device without a usable camera (today's capture rules). */
async function withoutCamera(context: BrowserContext) {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
  });
}

/** A synthetic photo: random noise over a flat colour, never a face or a
 * document, and different on every run (the risk check rejects reused photos). */
async function syntheticPhoto(width: number, height: number) {
  const noise = randomBytes(width * height * 3);
  return sharp(noise, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 70 })
    .toBuffer();
}

/** "Claim next 10" in a staff queue (as in member-post-publish.spec.ts): the
 * click is repeated until the claim request is sent, never once one was sent. */
async function claimQueue(page: Page, claims: () => Reply[], sent: () => number) {
  const button = page.getByRole("button", { name: "Claim next 10" });
  await expect(async () => {
    if (sent() === 0) await button.click();
    expect(sent()).toBeGreaterThan(0);
  }).toPass({ timeout: 30_000, intervals: [1_000, 2_000, 4_000] });
  await expect.poll(() => claims().map((entry) => entry.status)).toEqual([200]);
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

/** The refusal the database gives a staff command, or "allowed". */
async function staffCommandOutcome(copy: TestCopy, name: string, body: unknown, token: string) {
  const result = await rpc(copy, name, body, token);
  if (result.status === 200) return "allowed";
  return `${result.status} ${result.data?.code}: ${result.data?.message}`;
}

/** A member's identity case card in the staff identity queue. */
function identityCard(page: Page, member: VerifiedMember) {
  const displayName = queryTestCopy(
    `select display_name from private.profiles where account_id = '${member.id}';`
  );
  expect(displayName.length).toBeGreaterThan(1);
  // The nearest block around the member's name that holds the review buttons.
  return page
    .getByText(displayName, { exact: true })
    .locator('xpath=ancestor::div[.//button[normalize-space(.)="Review"]][1]');
}

function postStatus(id: string) {
  return queryTestCopy(
    `select coalesce(max(status), 'deleted') from private.posts where id = '${id}';`
  );
}

/** Deletes a member's post with the command the website's Delete button uses. */
async function deleteByCommand(owner: VerifiedMember, id: string) {
  const copy = readTestCopy();
  const session = await signIn(copy, owner);
  const revision = Number(queryTestCopy(`select revision from private.posts where id = '${id}';`));
  const result = await rpc(
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
  if (result.status !== 200) throw new Error(`Deleting a test post answered ${result.status}`);
}

function hasIntroAllowance(member: VerifiedMember) {
  return (
    queryTestCopy(
      "select count(*) from private.entitlements " +
        `where owner_id = '${member.id}' and source = 'intro_trial' and status = 'active';`
    ) === "1"
  );
}

/** Submits a business post through the website route the create form posts
 * to, from the member's browser with the page's CSRF token. */
async function submitBusiness(
  page: Page,
  owner: VerifiedMember,
  post: TestPost,
  [province, city]: [string, string]
) {
  // Any member page gives the browser the CSRF cookie the form would use.
  await page.goto("/dashboard");
  const submitted = await page.evaluate(
    async ({ name, slug, province, city }) => {
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
          location_province: province,
          location_city: city,
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
    { name: post.name, slug: post.name.toLowerCase().replaceAll(" ", "-"), province, city }
  );
  expect(submitted).toMatchObject({
    status: 200,
    body: { success: true, pendingReview: true, status: "pending_moderation" },
  });
  post.id = (submitted.body as { id: string }).id;
  post.owner = owner;
  expect(post.id).toMatch(UUID);
}

// Made in beforeAll, never at import time: listing specs must not touch the copy.
let copy: TestCopy;
let returned: VerifiedMember & { idNumber: string };
let poster: VerifiedMember & { idNumber: string };
let waiter: VerifiedMember;
type TestPost = { name: string; id: string; owner?: VerifiedMember };
const posts: { approved: TestPost; waiting: TestPost } = {
  approved: { name: "", id: "" },
  waiting: { name: "", id: "" },
};
let reportId = "";

test.describe("staff review with an authenticator", () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    copy = readTestCopy();
    returned = { ...(await registerUnreviewedMember("returned")), idNumber: syntheticIdNumber() };
    poster = { ...(await registerUnreviewedMember("poster")), idNumber: syntheticIdNumber() };
    // Owns the post that stays waiting for review (the introductory allowance
    // funds one business post per member). Verified through the production
    // commands, as in checkout-fulfilment.spec.ts.
    waiter = await registerVerifiedMember("waiter");
    const ref = poster.lastName.slice(-8);
    posts.approved.name = `Reviewed Studio ${ref}`;
    posts.waiting.name = `Waiting Studio ${ref}`;
  });

  // A marked step may fail only through its known break (support/known-break.ts).
  test.afterEach(({}, testInfo) => requireOnlyKnownBreak(testInfo));

  test.afterAll(async () => {
    // Leave no public or waiting post behind: the copy's showroom and staff
    // queues are shared with the other specs.
    for (const post of [posts.approved, posts.waiting])
      if (post.owner && post.id && postStatus(post.id) !== "deleted") {
        // An open staff hold refuses deletion; close the spec's own hide first.
        queryTestCopy(
          "update private.frontend_content_holds set version = version + 1, released_at = now(), " +
            `release_reason = 'Test copy clean-up' where post_id = '${post.id}' and released_at is null;`
        );
        await deleteByCommand(post.owner, post.id);
      }
  });

  test("a staff action without a fresh authenticator code is refused", async ({
    browser,
    context,
    page,
  }) => {
    test.setTimeout(120_000);
    const mark = readOutboundAttempts().length;
    // Non-sensitive (case:claim, 12-hour window): a random case id, so an
    // allowed caller gets "case not open" and nothing changes.
    const claimCase = { p_case_id: randomUUID() };
    const caseNotOpen = "400 22023: case not open";
    // Sensitive (dsar:manage, 15-minute window): a read of the privacy queue.
    const privacyQueue = { p_view: "open", p_page: 1 };

    // In the database: every staff command checks the session itself.
    const noCode = await signIn(copy, "moderator", { passwordOnly: true });
    expect(noCode.aal).toBe("aal1");
    expect(await staffCommandOutcome(copy, "claim_evidence_case", claimCase, noCode.token)).toBe(
      "403 42501: staff session with second factor required"
    );
    const oldCode = await signIn(copy, "moderator", { authenticatorAgeSeconds: 13 * 3600 });
    expect(oldCode.aal).toBe("aal2");
    expect(await staffCommandOutcome(copy, "claim_evidence_case", claimCase, oldCode.token)).toBe(
      "403 42501: staff second-factor verification expired"
    );
    const freshCode = await signIn(copy, "moderator");
    expect(await staffCommandOutcome(copy, "claim_evidence_case", claimCase, freshCode.token)).toBe(
      caseNotOpen
    );
    const twentyMinutes = await signIn(copy, "admin", { authenticatorAgeSeconds: 20 * 60 });
    expect(
      await staffCommandOutcome(copy, "claim_evidence_case", claimCase, twentyMinutes.token)
    ).toBe(caseNotOpen);
    expect(
      await staffCommandOutcome(
        copy,
        "get_frontend_privacy_queue",
        privacyQueue,
        twentyMinutes.token
      )
    ).toBe("403 42501: recent second-factor verification required");
    const freshAdmin = await signIn(copy, "admin");
    expect(
      await staffCommandOutcome(copy, "get_frontend_privacy_queue", privacyQueue, freshAdmin.token)
    ).toBe("allowed");

    // On the website: the staff pages send the person to the two-step page.
    const { outside, failures } = await guard(context);
    await signInBrowser(context, "moderator", { passwordOnly: true });
    await page.goto("/admin/moderation");
    await page.waitForURL((url) => url.pathname === TWO_STEP_PATH);
    const stale = await otherBrowser(browser, "moderator", { authenticatorAgeSeconds: 13 * 3600 });
    const sensitive = await otherBrowser(browser, "admin", { authenticatorAgeSeconds: 20 * 60 });
    try {
      await stale.page.goto("/admin/moderation");
      await stale.page.waitForURL((url) => url.pathname === TWO_STEP_PATH);
      await sensitive.page.goto("/admin/dsar");
      await sensitive.page.waitForURL((url) => url.pathname === TWO_STEP_PATH);
      // The same admin session still opens a page whose reads are not sensitive.
      await sensitive.page.goto("/admin/moderation");
      await expect(sensitive.page.getByRole("button", { name: "Claim next 10" })).toBeVisible();
      expect(new URL(sensitive.page.url()).pathname).toBe("/admin/moderation");
      for (const other of [stale, sensitive]) {
        expect(other.failures).toEqual([]);
        expect(other.outside).toEqual([]);
      }
    } finally {
      await stale.context.close();
      await sensitive.context.close();
    }
    expect(failures).toEqual([]);
    expect(outside).toEqual([]);
    expectNoOutboundSince(mark);
  });

  test("two members send their ID and selfie photos through the website", async ({ browser }) => {
    test.setTimeout(180_000);
    const mark = readOutboundAttempts().length;
    for (const member of [returned, poster]) {
      const context = await browser.newContext({ serviceWorkers: "block" });
      try {
        await withoutCamera(context);
        const { outside, failures, reply } = await guard(context);
        await signInBrowser(context, member);
        const page = await context.newPage();
        await page.goto("/verification");
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
        await expect
          .poll(() => reply("/api/verification/upload").length, { timeout: 30_000 })
          .toBe(1);
        await expect(page.getByRole("heading", { name: "Live selfie" })).toBeVisible({
          timeout: 20_000,
        });
        await page.getByRole("button", { name: "Open camera" }).click();
        await page.getByLabel("Or upload a photo").setInputFiles({
          name: "selfie.jpg",
          mimeType: "image/jpeg",
          buffer: await syntheticPhoto(600, 800),
        });
        await page.getByRole("button", { name: "Continue" }).click();
        await expect
          .poll(() => reply("/api/verification/upload").length, { timeout: 30_000 })
          .toBe(2);
        expect(reply("/api/verification/upload").map((entry) => entry.status)).toEqual([200, 200]);
        await page.getByRole("combobox", { name: "Province" }).selectOption("KwaZulu-Natal");
        await page.getByRole("combobox", { name: "City" }).selectOption("Richards Bay");
        await page.getByRole("button", { name: "Save location & finish" }).click();
        await expect
          .poll(() => reply("/api/verification/location/manual").length, { timeout: 30_000 })
          .toBe(1);
        await expect(page.getByRole("heading", { name: "Verification submitted" })).toBeVisible({
          timeout: 20_000,
        });
        expect(
          queryTestCopy(
            "select count(*) from private.verification_identity_submissions " +
              `where owner_id = '${member.id}';`
          )
        ).toBe("1");
        expect(failures).toEqual([]);
        expect(outside).toEqual([]);
      } finally {
        await context.close();
      }
    }
    expectNoOutboundSince(mark);
  });

  test("an admin sends one member's ID back with a reason", async ({ context, page }) => {
    test.setTimeout(120_000);
    const mark = readOutboundAttempts().length;
    const { outside, failures, reply, sentTo } = await guard(context);
    await signInBrowser(context, "admin");
    await page.goto("/admin/verification");
    await claimQueue(
      page,
      () => reply("/api/admin/queue"),
      () => sentTo("/api/admin/queue")
    );
    const card = identityCard(page, returned);
    await expect(card).toHaveCount(1);
    // The first step is the ID photo.
    await card.getByRole("button", { name: "Resubmit" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Request Resubmission" });
    await dialog.getByRole("button", { name: "Glare or blur" }).click();
    await expect(dialog.getByLabel("Additional notes")).toHaveValue(RETAKE_NOTE);
    await dialog.getByRole("button", { name: "Request Resubmission" }).click();
    await expect.poll(() => reply("/api/admin/verification/decide").length).toBe(1);
    expect(reply("/api/admin/verification/decide")[0]).toMatchObject({
      status: 200,
      body: { success: true, status: "needs_resubmission" },
    });
    await expect(dialog).toBeHidden();
    // The reviewer's reason is stored with the case.
    expect(
      queryTestCopy(
        "select count(*) from private.verification_return_requests r " +
          "join private.evidence_cases c on c.id = r.case_id " +
          `where c.subject_id = '${returned.id}' and position('${RETAKE_NOTE}' in r.reason) > 0;`
      )
    ).toBe("1");
    expect(
      queryTestCopy(
        `select count(*) from private.accepted_identity_facts where owner_id = '${returned.id}';`
      )
    ).toBe("0");
    expect(failures).toEqual([]);
    expect(outside).toEqual([]);
    expectNoOutboundSince(mark);
  });

  test("an admin accepts the other member's ID and selfie", async ({ context, page, request }) => {
    test.setTimeout(150_000);
    const mark = readOutboundAttempts().length;
    const { outside, failures, reply, sentTo } = await guard(context);
    await signInBrowser(context, "admin");
    await page.goto("/admin/verification");
    // Claims taken in the previous step may still be held; claim again only
    // when this member's case is not shown yet.
    const card = identityCard(page, poster);
    if ((await card.count()) === 0)
      await claimQueue(
        page,
        () => reply("/api/admin/queue"),
        () => sentTo("/api/admin/queue")
      );
    await expect(card).toHaveCount(1);
    for (const step of ["ID", "selfie"] as const) {
      await card.getByRole("button", { name: "Review", exact: true }).first().click();
      const viewer = page.getByRole("dialog", { name: /^Identity Comparison/ });
      await expect(viewer).toBeVisible();
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
          `where owner_id = '${poster.id}' and revoked_at is null;`
      )
    ).toBe("1");
    // The member's "identity accepted" email is queued for the email job.
    expect(
      queryTestCopy(
        "select count(*) from private.outbox_events where kind = 'identity_accepted' " +
          `and owner_id = '${poster.id}';`
      )
    ).toBe("1");
    expect((await runOpsJob(request)).retrying).toBe(0);
    // The area was saved with the photos; the posting terms remain.
    await acceptPostingTerms(poster);
    expect(failures).toEqual([]);
    expect(outside).toEqual([]);
    expectNoOutboundSince(mark);
  });

  test("an admin cannot review their own identity case", async () => {
    const admin = await signIn(copy, "admin");
    const adminId = queryTestCopy(
      "select id from auth.users where email = 'admin@verifymzansi.test';"
    );
    expect(adminId).toMatch(UUID);
    const before = queryTestCopy(
      `select count(*) from private.evidence_cases where subject_id = '${adminId}';`
    );
    const opened = await rpc(copy, "open_verification_case", {}, admin.token);
    expect(opened.status).toBe(200);
    const caseId = String(opened.data.case_id);
    expect(caseId).toMatch(UUID);
    try {
      expect(
        await staffCommandOutcome(copy, "claim_evidence_case", { p_case_id: caseId }, admin.token)
      ).toBe("403 42501: self-review is not allowed");
      expect(
        queryTestCopy(
          `select count(*) from private.evidence_cases where id = '${caseId}' and claimed_by is not null;`
        )
      ).toBe("0");
    } finally {
      // Trusted local step: remove the empty case this test opened (no evidence).
      if (before === "0")
        queryTestCopy(
          `delete from private.evidence_cases where id = '${caseId}' and subject_id = '${adminId}';`
        );
    }
  });

  test("a moderator approves a member's post in the moderation queue", async ({
    browser,
    context,
    page,
    request,
  }) => {
    test.setTimeout(150_000);
    const mark = readOutboundAttempts().length;
    const { outside, failures } = await guard(context);
    // The every-minute job gives each newly verified member the introductory
    // allowance (one business post).
    for (let run = 0; run < 5 && !hasIntroAllowance(waiter); run++) await runOpsJob(request);
    expect(hasIntroAllowance(poster) && hasIntroAllowance(waiter)).toBe(true);
    await signInBrowser(context, poster);
    await submitBusiness(page, poster, posts.approved, ["KwaZulu-Natal", "Richards Bay"]);
    const other = await otherBrowser(browser, waiter);
    try {
      await submitBusiness(other.page, waiter, posts.waiting, ["Gauteng", "Johannesburg"]);
      expect(other.failures).toEqual([]);
      expect(other.outside).toEqual([]);
    } finally {
      await other.context.close();
    }

    const staff = await otherBrowser(browser, "moderator");
    try {
      await staff.page.goto("/admin/moderation");
      await claimQueue(
        staff.page,
        () => staff.reply("/api/admin/queue"),
        () => staff.sentTo("/api/admin/queue")
      );
      const item = staff.page
        .locator("div")
        .filter({ hasText: posts.approved.name })
        .filter({ has: staff.page.getByRole("button", { name: "Approve" }) })
        .last();
      await item.getByRole("button", { name: "Approve" }).click();
      const dialog = staff.page.getByRole("dialog", { name: "Approve Content" });
      await dialog.getByRole("button", { name: "Publish" }).click();
      await expect.poll(() => staff.reply("/api/admin/content/decide").length).toBe(1);
      expect(staff.reply("/api/admin/content/decide")[0].status).toBe(200);
      expect(staff.failures).toEqual([]);
      expect(staff.outside).toEqual([]);
    } finally {
      await staff.context.close();
    }
    expect(postStatus(posts.approved.id)).toBe("live");
    expect(postStatus(posts.waiting.id)).toBe("pending_moderation");
    expect(failures).toEqual([]);
    expect(outside).toEqual([]);
    expectNoOutboundSince(mark);
  });

  test("a report filed by the moderator is decided by an admin, never by its filer", async ({
    browser,
    context,
    page,
  }) => {
    test.setTimeout(150_000);
    const mark = readOutboundAttempts().length;
    const { outside, failures, reply, sentTo } = await guard(context);
    const moderatorId = await signInBrowser(context, "moderator");
    const description = `The studio ${posts.approved.name} shows photos copied from another seller.`;
    await page.goto(`/mzansi-business/${posts.approved.id}`);
    // Wait until the page has chosen its layout (on wide screens the post
    // opens in the full-screen viewer and the classic page is hidden).
    await expect(page.locator("[data-immersive-pending]")).toHaveCount(0);
    await expect(
      page.getByText(posts.approved.name).filter({ visible: true }).first()
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Report", exact: true })
      .filter({ visible: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog", { name: "Report profile" });
    await dialog.getByLabel("Reason").selectOption("misleading");
    await dialog.getByLabel("Describe the issue").fill(description);
    await dialog.getByRole("button", { name: "Send report" }).click();
    await expect.poll(() => reply("/api/reports").length, { timeout: 30_000 }).toBe(1);
    await expect(dialog.getByText("Report submitted")).toBeVisible({ timeout: 15_000 });
    expect(reply("/api/reports")).toEqual([
      expect.objectContaining({ status: 200, body: { success: true } }),
    ]);
    reportId = queryTestCopy(
      "select id from private.reports " +
        `where post_id = '${posts.approved.id}' and reporter_id = '${moderatorId}' and status = 'open';`
    );
    expect(reportId).toMatch(UUID);

    // The filer cannot take it: claiming the reports queue leaves it unclaimed,
    // and the filer's queue does not list it at all.
    await page.goto("/admin/reports");
    await claimQueue(
      page,
      () => reply("/api/admin/queue"),
      () => sentTo("/api/admin/queue")
    );
    expect(
      queryTestCopy(
        `select count(*) from private.queue_claims where report_id = '${reportId}' and claimed_by is not null;`
      )
    ).toBe("0");
    await expect(
      page.getByText("No independent waiting items are available to claim.", { exact: false })
    ).toBeVisible();
    await expect(page.getByText(`Report #${reportId.slice(0, 8)}`)).toHaveCount(0);

    // An admin claims it and hides the post.
    const admin = await otherBrowser(browser, "admin");
    try {
      await admin.page.goto("/admin/reports");
      await claimQueue(
        admin.page,
        () => admin.reply("/api/admin/queue"),
        () => admin.sentTo("/api/admin/queue")
      );
      const item = admin.page
        .locator("div")
        .filter({ hasText: `Report #${reportId.slice(0, 8)}` })
        .filter({ has: admin.page.getByRole("button", { name: "Take action" }) })
        .last();
      await item.getByRole("button", { name: "Take action" }).click();
      const act = admin.page.getByRole("dialog", { name: "Act on report" });
      await act.getByRole("button", { name: "Hide this content" }).click();
      await act
        .getByPlaceholder("Reason for this enforcement action...")
        .fill("Copied photos confirmed against the original seller's profile.");
      await act.getByRole("button", { name: "Apply action" }).click();
      await expect.poll(() => admin.reply("/api/admin/flagging/action").length).toBe(1);
      expect(admin.reply("/api/admin/flagging/action")[0]).toMatchObject({
        status: 200,
        body: { success: true, action: "hide", status: "applied" },
      });
      await expect(act).toBeHidden();
      expect(admin.failures).toEqual([]);
      expect(admin.outside).toEqual([]);
    } finally {
      await admin.context.close();
    }
    expect(queryTestCopy(`select status from private.reports where id = '${reportId}';`)).toBe(
      "resolved"
    );
    expect(postStatus(posts.approved.id)).not.toBe("live");
    // While the hold is open the owner cannot delete the hidden post.
    const owner = await signIn(copy, poster);
    const refused = await rpc(
      copy,
      "execute_my_frontend_post_action",
      {
        p_request: randomUUID(),
        p_post: posts.approved.id,
        p_expected_revision: Number(
          queryTestCopy(`select revision from private.posts where id = '${posts.approved.id}';`)
        ),
        p_action: "delete",
        p_kind: "business",
        p_area: "business",
      },
      owner.token
    );
    expect(refused.status).toBe(423);
    // The website's Delete route explains the hold to the owner.
    const ownerBrowser = await otherBrowser(browser, poster);
    try {
      await ownerBrowser.page.goto("/dashboard");
      const routed = await ownerBrowser.page.evaluate(
        async ({ id, revision }) => {
          const token = document.cookie.match(/(?:^|; )vm_csrf=([a-f0-9]{64})/)?.[1] ?? "";
          const response = await fetch("/api/content/delete", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json", "x-csrf-token": token },
            body: JSON.stringify({
              itemId: id,
              area: "MZANSI_BUSINESS",
              contentType: "business",
              operationId: crypto.randomUUID(),
              expectedRevision: revision,
            }),
          });
          return { status: response.status, body: await response.json() };
        },
        {
          id: posts.approved.id,
          revision: Number(
            queryTestCopy(`select revision from private.posts where id = '${posts.approved.id}';`)
          ),
        }
      );
      expect(routed).toEqual({
        status: 409,
        body: {
          error:
            "This post is hidden while our team reviews it. You can't republish, sell or delete it until the review is finished.",
          reason: "staff_visibility_hold",
        },
      });
    } finally {
      await ownerBrowser.context.close();
    }
    expect(postStatus(posts.approved.id)).toBe("paused");
    // The owner is told the post was hidden.
    expect(
      queryTestCopy(
        "select count(*) from private.outbox_events where kind = 'content_hidden' " +
          `and owner_id = '${poster.id}';`
      )
    ).toBe("1");
    expect(failures).toEqual([]);
    expect(outside).toEqual([]);
    expectNoOutboundSince(mark);
  });

  test("an admin verifies, approves and completes a member's privacy request", async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    const mark = readOutboundAttempts().length;
    // The member's request is recorded with the production command the /dsar
    // route calls once its CAPTCHA check passed (caller-bound: the member's
    // live session). The copy cannot pass that check through the form: the
    // site's test-mode CAPTCHA answer carries no hostname, and the route
    // requires the site's own hostname in production builds.
    const session = await signIn(copy, poster);
    const sessionId = String(
      JSON.parse(Buffer.from(session.token.split(".")[1], "base64url").toString("utf8")).session_id
    );
    expect(sessionId).toMatch(UUID);
    const recorded = await serviceRpc("record_frontend_privacy_request", {
      p_account: poster.id,
      p_session: sessionId,
      p_type: "access",
      p_name: `${poster.firstName} ${poster.lastName}`,
      p_last_four: poster.idNumber.slice(-4),
      p_details: "Please send a copy of my account data.",
    });
    expect(recorded.status).toBe(200);
    const requestId = String(recorded.data.id);
    expect(requestId).toMatch(UUID);
    const admin = await otherBrowser(browser, "admin");
    try {
      await admin.page.goto("/admin/dsar");
      const card = admin.page
        .locator("div")
        .filter({ hasText: `DSAR-${requestId.slice(0, 8).toUpperCase()}` })
        .filter({
          has: admin.page.getByRole("button", {
            name: /^(Verify identity|Approve request|Complete request)$/,
          }),
        })
        .last();
      await card.getByRole("button", { name: "Verify identity" }).click();
      await admin.page
        .getByRole("dialog", { name: "Verify Requester Identity" })
        .getByRole("button", { name: "I have verified the requester's identity" })
        .click();
      await expect.poll(() => admin.reply("/api/admin/dsar/decide").length).toBe(1);
      await card.getByRole("button", { name: "Approve request" }).click();
      await expect.poll(() => admin.reply("/api/admin/dsar/decide").length).toBe(2);
      await card.getByRole("button", { name: "Complete request" }).click();
      const complete = admin.page.getByRole("dialog", { name: "Complete Data Request" });
      await complete
        .getByLabel("Completion summary")
        .fill("Account data export sent to the verified address.");
      await complete.getByRole("button", { name: "Confirm completion" }).click();
      await expect.poll(() => admin.reply("/api/admin/dsar/complete").length).toBe(1);
      expect(
        [...admin.reply("/api/admin/dsar/decide"), ...admin.reply("/api/admin/dsar/complete")].map(
          (entry) => entry.status
        )
      ).toEqual([200, 200, 200]);
      expect(admin.failures).toEqual([]);
      expect(admin.outside).toEqual([]);
    } finally {
      await admin.context.close();
    }
    expect(
      queryTestCopy(
        "select status || '|' || identity_verified from private.privacy_requests " +
          `where id = '${requestId}';`
      )
    ).toBe("completed|true");
    expectNoOutboundSince(mark);
  });

  test("the member whose ID was sent back is told why and notified", async ({ context, page }) => {
    test.fail(true, BL12);
    await characterise(BL12, async () => {
      const mark = readOutboundAttempts().length;
      const { outside, failures } = await guard(context);
      const returnedAt = queryTestCopy(
        "select min(r.created_at) from private.verification_return_requests r " +
          `join private.evidence_cases c on c.id = r.case_id where c.subject_id = '${returned.id}';`
      );
      expect(returnedAt).not.toBe("");
      // Anything queued to tell the member since the ID was sent back.
      const notices = Number(
        queryTestCopy(
          `select (select count(*) from private.outbox_events where owner_id = '${returned.id}' and created_at >= '${returnedAt}') + ` +
            `(select count(*) from private.notifications where account_id = '${returned.id}' and created_at >= '${returnedAt}');`
        )
      );
      await signInBrowser(context, returned);
      await page.goto("/verification");
      const reason = page.getByText(RETAKE_NOTE).first();
      const generic = page.getByText(GENERIC_ID_RETURN).first();
      await expect(reason.or(generic).first()).toBeVisible({ timeout: 20_000 });
      if ((await generic.isVisible()) && !(await reason.isVisible()) && notices === 0) {
        // BL-12 as recorded: the reviewer's reason is stored, but the page
        // shows generic text, and no email or notice was queued.
        expect(failures).toEqual([]);
        expect(outside).toEqual([]);
        expectNoOutboundSince(mark);
        throw new KnownBreak(
          `${BL12}: the verification page shows generic text instead of the reviewer's reason, and nothing was queued to tell the member`
        );
      }
      // Promised (M2.7): the member reads the reviewer's reason and is told.
      await expect(reason).toBeVisible();
      expect(notices).toBeGreaterThan(0);
      expect(failures).toEqual([]);
      expect(outside).toEqual([]);
      expectNoOutboundSince(mark);
    });
  });

  test("the per-section review queue lists the waiting post", async ({ context, page }) => {
    test.fail(true, D3B02);
    await characterise(D3B02, async () => {
      const mark = readOutboundAttempts().length;
      const { outside, failures } = await guard(context);
      expect(postStatus(posts.waiting.id)).toBe("pending_moderation");
      await signInBrowser(context, "moderator");
      await page.goto("/admin/businesses");
      await expect(page.getByRole("heading", { name: "Mzansi Business", level: 1 })).toBeVisible({
        timeout: 20_000,
      });
      const broken = page.getByRole("alert").filter({
        hasText:
          "The content review queue could not be loaded. Refresh to try again. This does not mean there is nothing waiting.",
      });
      if (await broken.isVisible()) {
        // D3B-02 as recorded: only the content queue fails (it reads the
        // retired backend; the page's other panels load), and the overview
        // counts no waiting content although a post waits for review.
        await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(1);
        const tile = page
          .locator("div")
          .filter({ hasText: /^\s*\d+\s*Pending Content\s*$/ })
          .last();
        await expect(tile).toHaveText(/^\s*0\s*Pending Content\s*$/);
        expect(failures).toEqual([]);
        expect(outside).toEqual([]);
        expectNoOutboundSince(mark);
        throw new KnownBreak(
          `${D3B02}: the business section page could not load its content review queue while a post was waiting`
        );
      }
      // Promised (M6.3): the waiting post is listed for review.
      await expect(page.getByText(posts.waiting.name).first()).toBeVisible();
      expect(failures).toEqual([]);
      expect(outside).toEqual([]);
      expectNoOutboundSince(mark);
    });
  });

  test("the operations page shows job health", async ({ context, page }) => {
    test.fail(true, D502);
    await characterise(D502, async () => {
      const mark = readOutboundAttempts().length;
      const { outside, failures } = await guard(context);
      await signInBrowser(context, "admin");
      await page.goto("/admin/operations");
      const broken = page.getByRole("alert").filter({
        hasText:
          "Operations health could not be loaded. Refresh to try again. This does not mean everything is working.",
      });
      const healthy = page.getByRole("heading", { name: "Operations health" });
      await expect(broken.or(healthy).first()).toBeVisible({ timeout: 20_000 });
      if (await broken.isVisible()) {
        // D5-02 as recorded: the page reads retired tables and functions.
        expect(failures).toEqual([]);
        expect(outside).toEqual([]);
        expectNoOutboundSince(mark);
        throw new KnownBreak(`${D502}: the operations page could not load job health`);
      }
      // Promised (M5.5): the job health tiles are shown.
      await expect(page.getByText("Stuck jobs")).toBeVisible();
      await expect(page.getByText("Failed decision updates")).toBeVisible();
      expect(failures).toEqual([]);
      expect(outside).toEqual([]);
      expectNoOutboundSince(mark);
    });
  });
});
