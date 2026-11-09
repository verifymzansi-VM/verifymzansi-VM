import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { E2E_FIXTURE, KNOWN_BREACHED_PASSWORD } from "../../scripts/lib/foundation-e2e-target.mjs";
import { characterise, KnownBreak, requireOnlyKnownBreak } from "./support/known-break";
import {
  googleMemberSession,
  registerGoogleMember,
  type GoogleMember,
} from "./support/google-member";
import {
  browserSessionCookies,
  latestMailTo,
  mailCountTo,
  queryTestCopy,
  readOutboundAttempts,
  readServerLogEntries,
  readTestCopy,
  serverLogMentions,
  sessionCookies,
  sessionIsLive,
  signIn,
} from "./support/test-copy";
import {
  registerConfirmedMember,
  verifyPhone,
  type VerifiedMember,
} from "./support/verified-member";

// Critical-flow test (M0.9e): account recovery and self-service on the
// restored website in foundation mode against the private test copy. New
// members per run (each flow that changes or ends an account has its own):
//   - a member asks for a reset link on the forgot-password page, finds it in
//     the local mail catcher and opens it: the reset page accepts the
//     recovery session; an unknown address gets the same answer and no email;
//     a used link cannot be opened again;
//   - a member saves a new password from that link and signs in with it; the
//     old password stops working;
//   - after opening link A and then link B in the same browser, the form from
//     link A is refused ("Your recovery session changed. Check the link
//     again."), while the form from link B still works;
//   - a known-breached password is refused on the reset page;
//   - saving the password the member already has completes the reset (local
//     Auth answers "same_password", which the reset treats as in force);
//   - a reset link's token redeemed straight at local Auth's verify endpoint
//     (an `otp` session, no PKCE check) can use no sensitive command;
//   - without the link's binding, the reset link's session can set no
//     password: not on the reset page, not through the profile page's
//     password change (even with a wrong current password) and not by asking
//     for a password setup link;
//   - a Google member (no password) whose sign-in is over an hour old is
//     asked to sign in again before "Set Password" sends anything;
//   - a Google member (no password) sets a password from the profile page:
//     the setup email's link opens the reset page, a known-breached password
//     is refused there, the chosen one works for email sign-in, every session
//     (including the Google one) is signed out, and asking again from a
//     session signed in with that password is refused;
//   - a member whose sign-in is over an hour old is asked to sign in again
//     before an email change sends anything; signed in again, asking for an
//     address that belongs to another account gets the usual answer and no
//     email reaches anyone; right after a change, a taken and a free address
//     get the same answer, no sooner than the answer floor;
//   - a member changes the sign-in email: the current and the new address
//     each get a confirmation link; until both are opened the old address
//     still signs in and the new one does not, then only the new one does;
//     opening a link signs nobody in, and the member stays signed in;
//   - a member saves a communication choice, which stays saved;
//   - a member deletes the account and cannot sign in again.
//
// The reset page sends only the two password fields. The server remembers,
// when the link is opened, which recovery session it opened in this browser
// (an HttpOnly binding cookie), and the reset page's address names that
// opening (/reset-password?link=...), so a form from an earlier link is told
// apart from the latest one.
//
// "Set Password" sends only the member's email, no CAPTCHA token: the website
// accepts it from a signed-in session with a recent sign-in instead, and asks
// local Auth for the setup email with its server key.
//
// The email change sends only the new address: the website asks local Auth to
// start the change with the member's own session (never the server key), and
// local Auth, whose secure email change is on as on hosted Auth, emails both
// addresses. Each link returns to the website's callback, which only picks
// the page to show (the profile's Account tab) and opens no session.
//
// Two steps are broken today and are marked test.fail(), each pinned to its
// exact known symptom (characterise, support/known-break.ts); any other
// outcome turns the run red:
// - "... communication choices ...": SEC-09, fixed by M1.7. Saving a choice
//   writes a table of the retired backend and answers 500 with the database's
//   own refusal; reading the choices hides the same failure and shows every
//   choice "off", and the email history beside them fails on every visit.
// - "delete my account ...": SEC-02, fixed by M1.6c. The delete route reads a
//   table of the retired backend after re-checking the password and answers
//   500; the account stays and can still sign in.
// The tests run in order; a failure skips the rest, so the marked steps come
// after the working flow.
//
// Emails: local Auth sends its own emails (reset links) through its SMTP
// setting straight to the copy's mail catcher (Mailpit); the website's emails
// go through the copy's relay to the same catcher (.test recipients only).
// Nothing is delivered. Network: browser requests may only reach the copy's
// website and its local database gateway (anything else is aborted and fails
// the test), and the website's own server runs behind the copy's outbound
// fence, whose log may show only the password breach check it answers itself
// (as "breached" only for the copy's one known-breached test password).
//
// The CAPTCHA: the site's test mode hands forms the bypass token, which the
// foundation recovery request refuses by design (production Auth verifies real
// tokens). The test therefore swaps that one token in the forgot-password
// request for a stand-in token (as member-post-publish.spec.ts does for
// sign-up); the copy's local Auth has no CAPTCHA secret and accepts it, as
// hosted Auth accepts a real widget token. A request without a token is passed
// on unchanged.
//
// The Google member is made the way local Auth stores a Google sign-up and
// signs in through a one-time local Auth link whose session is then recorded
// as the Google (`oauth`) sign-in it stands for (support/google-member.ts,
// linkSession in support/test-copy.ts).

const APP_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.appPort}`;
const API_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.apiPort}`;
const SEC09 = "SEC-09, fixed by M1.7";
const SEC02 = "SEC-02, fixed by M1.6c";
const CAPTCHA_STAND_IN = "local-fixture-captcha-stand-in";
const RESET_PATH = "/api/auth/reset-password";
const RECOVERY_PATH = "/api/auth/forgot-password";
const EMAIL_CHANGE_PATH = "/api/account/email/change";
const PREFERENCES_PATH = "/api/communications/preferences";
const EMAIL_ACTIVITY_PATH = "/api/communications/email-activity";
const DELETE_PATH = "/api/account/delete";
/** The recovery request's answer, the same for every address. */
const RECOVERY_ANSWER = {
  ok: true,
  message: "If this address has an account, check your inbox for the next step.",
};
/** A link to local Auth, as it appears in a caught email. */
const AUTH_LINK = /http:\/\/127\.0\.0\.1:\d+\/auth\/v1\/verify\?[^\s)\]>"]+/;
/** The reset page an opened link leads to; its address names that opening. */
const RESET_PAGE = (url: URL) =>
  url.origin === APP_ORIGIN &&
  url.pathname === "/reset-password" &&
  /^\?link=[A-Za-z0-9_-]{22}$/.test(url.search);
/** The website's answers on the reset page (src/app/api/foundation/auth/_lib/recovery-complete.ts). */
const SESSION_CHANGED = { error: "Your recovery session changed. Check the link again." };
const BREACHED = {
  error: "This password has appeared in a known data breach. Choose a different password.",
};
/** "Set Password" without a recent sign-in (src/app/api/foundation/auth/_lib/password-setup.ts). */
const SIGN_IN_AGAIN = {
  error: "For your security, sign out and sign in again before setting a password.",
  code: "reauthentication_required",
};
/** An email change without a recent sign-in (src/app/api/foundation/auth/_lib/email-change.ts). */
const EMAIL_SIGN_IN_AGAIN = {
  error: "For your security, sign out and sign in again before changing your email address.",
  code: "reauthentication_required",
};
/** An email change from a reset link's (or other emailed link's) session. */
const EMAIL_RECOVERY_SESSION = {
  error: "Finish resetting your password, then sign in again to change your email address",
  reason: "recovery_session",
};
/** The minimum time an accepted email change answer takes (email-change.ts). */
const EMAIL_CHANGE_ANSWER_FLOOR_MS = 3000;
/** The one answer for an accepted email change, also for another account's address. */
const EMAIL_CHANGE_ACCEPTED = {
  success: true,
  message:
    "If the new address can be used, a confirmation link is on its way to it and to your current address. The change completes once both links are opened.",
};
/** Where an opened email change link lands: the profile's Account tab. */
const EMAIL_CHANGE_LANDING = (url: URL) =>
  url.origin === APP_ORIGIN && url.pathname === "/dashboard/profile" && url.hash === "#account";
/** A reset link's session asking for a password change or setup. */
const RECOVERY_SESSION = {
  error: "Use the reset link from your email to set a new password",
  reason: "recovery_session",
};
/** The binding the website keeps while an opened link may be used (plain http
 * here, so without the __Host- prefix production uses). */
const BINDING_COOKIE = "vm_recovery_binding";
/** Reset links already opened in this run; a new lookup waits for a newer one. */
const openedLinks = new Set<string>();

// A service worker could fetch outside page routing; the allowlist must see every request.
test.use({ serviceWorkers: "block" });
test.describe.configure({ mode: "serial" });

type Reply = { method: string; path: string; status: number; body: unknown };
/** What a request sent: its JSON field names only (never values such as
 * passwords), and on the recovery request the CAPTCHA token the page sent. */
type Sent = { method: string; path: string; fields: string[]; captcha?: unknown };

/** Lets only the copy's website and its gateway through, records the website's
 * API replies and the field names each request sent, and swaps the CAPTCHA
 * test-mode token on the recovery request (see above). */
async function guard(context: BrowserContext) {
  const outside: string[] = [];
  const failures: string[] = [];
  const replies: Reply[] = [];
  const sent: Sent[] = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== APP_ORIGIN && url.origin !== API_ORIGIN) {
      outside.push(url.origin);
      return route.abort("blockedbyclient");
    }
    if (url.origin !== APP_ORIGIN || !url.pathname.startsWith("/api/")) return route.continue();
    let postData: string | undefined;
    if (request.method() !== "GET") {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(request.postData() || "{}");
      } catch {
        // Not JSON; no fields to record.
      }
      sent.push({
        method: request.method(),
        path: url.pathname,
        fields: Object.keys(body).sort(),
        ...(url.pathname === RECOVERY_PATH ? { captcha: body.turnstileToken } : {}),
      });
      // Only the site's test-mode token is swapped; anything else goes as sent.
      if (url.pathname === RECOVERY_PATH && body.turnstileToken === "dev-turnstile-bypass")
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
  const reply = (pathname: string, method = "POST") =>
    replies.filter((entry) => entry.path === pathname && entry.method === method);
  const sentTo = (pathname: string, method = "POST") =>
    sent.filter((entry) => entry.path === pathname && entry.method === method);
  return { outside, failures, reply, sentTo };
}

type Guarded = Awaited<ReturnType<typeof guard>>;

/** No request left the browser's allowlist and no route handler failed. */
function expectContained(guarded: Pick<Guarded, "outside" | "failures">) {
  expect(guarded.failures).toEqual([]);
  expect(guarded.outside).toEqual([]);
}

/** The website's server contacted nothing off this machine since `mark`: the
 * only entry the copy's fence may have recorded is the password breach check
 * it answers itself. */
function expectNoProviderSince(mark: number) {
  expect(
    readOutboundAttempts()
      .slice(mark)
      .filter(
        (entry) =>
          entry.outcome !== "answered-locally" || entry.origin !== "https://api.pwnedpasswords.com"
      )
  ).toEqual([]);
}

/** The same as a reply's body, compared as JSON (for exact pins). */
function sameJson(actual: unknown, expected: unknown) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

async function signInBrowser(context: BrowserContext, member: VerifiedMember) {
  const session = await browserSessionCookies(readTestCopy(), member);
  await context.addCookies(session.cookies.map((cookie) => ({ ...cookie, url: APP_ORIGIN })));
  expect(session.accountId).toBe(member.id);
}

/** Whether local Auth accepts this email and password (a real sign-in). */
async function canSignIn(email: string, password: string) {
  return signIn(readTestCopy(), { email, password }).then(
    () => true,
    () => false
  );
}

/** The local Auth link in the newest email to `address` since `after`. Waits
 * past emails without one (a password-change notice) and links already opened
 * in this run, so two requests in quick succession get their own links. */
async function authLinkFor(address: string, after: number) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const mail = await latestMailTo(address, { after, timeoutMs: deadline - Date.now() });
    const link = mail.text.match(AUTH_LINK)?.[0];
    if (link) {
      const url = new URL(link.replaceAll("&amp;", "&"));
      if (url.origin !== API_ORIGIN) throw new Error("Auth links stay on the local gateway");
      if (!openedLinks.has(url.href)) return url;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("No new email with a local Auth link reached the local mail catcher");
}

/**
 * The forgot-password page: asks for a reset link for `email`, as a visitor
 * does. Returns when the page confirms (the same answer for every address).
 */
async function requestResetLink(page: Page, guarded: Guarded, email: string) {
  const before = guarded.reply(RECOVERY_PATH).length;
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect.poll(() => guarded.reply(RECOVERY_PATH).length).toBe(before + 1);
  expect(guarded.reply(RECOVERY_PATH).at(-1)).toMatchObject({ status: 200, body: RECOVERY_ANSWER });
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
}

/**
 * Asks for a reset link for the member and opens it from the mail catcher in
 * the same browser (which holds the sign-in verifier the link needs). Returns
 * the link once the reset page has accepted the recovery session.
 */
async function openResetLink(page: Page, guarded: Guarded, member: VerifiedMember) {
  const sentAfter = Date.now() - 1000;
  await requestResetLink(page, guarded, member.email);
  const link = await authLinkFor(member.email, sentAfter);
  openedLinks.add(link.href);
  await page.goto(link.href);
  await page.waitForURL(RESET_PAGE);
  await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible({
    timeout: 20_000,
  });
  const check = guarded.reply(RESET_PATH, "GET").at(-1);
  expect(check?.status).toBe(200);
  // Only the answer reaches the page; the recovery session stays on the server.
  expect(check?.body).toEqual({ valid: true });
  return link;
}

/** Opens one tab of the profile page. */
async function openProfileTab(page: Page, tab: "Security" | "Account") {
  await page.goto("/dashboard/profile");
  await page.getByRole("tab", { name: tab }).click();
  await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
}

/** The toast the page shows for an outcome, by its title. */
function toast(page: Page, title: string) {
  return page.getByText(title, { exact: true }).first();
}

/** The member's sign-in email and any email change local Auth holds open. */
function storedEmail(id: string) {
  return queryTestCopy(
    `select email || '|' || coalesce(email_change, '') from auth.users where id = '${id}';`
  );
}

/** The local Auth sessions an account has (opening a link must add none). */
function sessionCount(id: string) {
  return queryTestCopy(`select count(*) from auth.sessions where user_id = '${id}';`);
}

/** The profile page's email change, as a member does it. Returns the reply. */
async function requestEmailChange(page: Page, guarded: Guarded, newEmail: string) {
  const before = guarded.reply(EMAIL_CHANGE_PATH).length;
  await openProfileTab(page, "Account");
  await page.getByRole("button", { name: "Change", exact: true }).click();
  await page.getByPlaceholder("New email address").fill(newEmail);
  await page.getByRole("button", { name: "Send confirmation" }).click();
  await expect
    .poll(() => guarded.reply(EMAIL_CHANGE_PATH).length, { timeout: 20_000 })
    .toBe(before + 1);
  // The restored page sends only the new address.
  expect(guarded.sentTo(EMAIL_CHANGE_PATH).at(-1)?.fields.join()).toBe("newEmail");
  return guarded.reply(EMAIL_CHANGE_PATH).at(-1)!;
}

/** The profile page's Account tab, which shows the sign-in address. */
function accountTab(page: Page) {
  return page.getByRole("tabpanel", { name: "Account" });
}

/** Opens an email change link from the mail catcher; it lands on the Account tab. */
async function openEmailChangeLink(page: Page, link: URL) {
  expect(link.searchParams.get("type")).toBe("email_change");
  openedLinks.add(link.href);
  await page.goto(link.href);
  await page.waitForURL(EMAIL_CHANGE_LANDING);
  await expect(page.getByRole("tab", { name: "Account" })).toHaveAttribute("aria-selected", "true");
}

// Made in beforeAll, never at import time: listing specs must not touch the copy.
let resetter: VerifiedMember;
let google: GoogleMember;
let mover: VerifiedMember;
let chooser: VerifiedMember;
let leaver: VerifiedMember;

test.describe("account recovery and self-service", () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    // The reset pages need no more than a confirmed email; the member pages
    // (profile, communication) open only once the phone is verified. The
    // last member is made only to be deleted.
    const withPhone = async <T extends { id: string }>(member: T) => {
      await verifyPhone(member.id);
      return member;
    };
    resetter = await registerConfirmedMember("resetter");
    google = await withPhone(await registerGoogleMember("google"));
    mover = await withPhone(await registerConfirmedMember("mover"));
    chooser = await withPhone(await registerConfirmedMember("chooser"));
    leaver = await withPhone(await registerConfirmedMember("leaver"));
  });

  // A marked step may fail only through its known break (support/known-break.ts).
  test.afterEach(({}, testInfo) => requireOnlyKnownBreak(testInfo));

  test("a member asks for a reset link and opens it from the mail catcher", async ({
    browser,
    context,
    page,
  }) => {
    test.setTimeout(120_000);
    const mark = readOutboundAttempts().length;
    const guarded = await guard(context);
    // An address without an account gets the same answer and no email.
    const unknown = `unknown-${resetter.lastName.slice(-8)}@verifymzansi.test`;
    await requestResetLink(await context.newPage(), guarded, unknown);
    const link = await openResetLink(page, guarded, resetter);
    // The page sent the site's test-mode CAPTCHA token (swapped above).
    expect(guarded.sentTo(RECOVERY_PATH).map((entry) => entry.captcha)).toEqual([
      "dev-turnstile-bypass",
      "dev-turnstile-bypass",
    ]);
    expect(await mailCountTo(unknown)).toBe(0);
    // The link works once: opened again, local Auth itself refuses it as used
    // ("otp_expired", after "#") and the website sends the visitor back to ask
    // for a new one.
    const other = await browser.newContext({ serviceWorkers: "block" });
    try {
      const otherGuard = await guard(other);
      const again = await other.newPage();
      const callbacks: URL[] = [];
      again.on("request", (sent) => {
        const url = new URL(sent.url());
        if (url.origin === APP_ORIGIN && url.pathname === "/auth/callback") callbacks.push(url);
      });
      await again.goto(link.href);
      await again.waitForURL(
        (url) =>
          url.origin === APP_ORIGIN &&
          url.pathname === "/forgot-password" &&
          url.search === "?error=recovery_failed"
      );
      expect(callbacks.map((url) => url.searchParams.get("error_code"))).toEqual(["otp_expired"]);
      // The failure page's address carries an empty fragment, so the one local
      // Auth put on the refused link (its error details) is not kept.
      expect(new URL(again.url()).hash).toBe("");
      // The visitor can ask for a new link there (the page does not say why).
      await expect(again.getByRole("heading", { name: "Forgot your password?" })).toBeVisible();
      expectContained(otherGuard);
    } finally {
      await other.close();
    }
    // Opening the link changed nothing yet: the password still works.
    expect(await canSignIn(resetter.email, resetter.password)).toBe(true);
    expectContained(guarded);
    expectNoProviderSince(mark);
  });

  test("a member resets a forgotten password and signs in with the new one", async ({
    context,
    page,
  }) => {
    test.setTimeout(120_000);
    const mark = readOutboundAttempts().length;
    const guarded = await guard(context);
    await openResetLink(page, guarded, resetter);
    // Opening the link left a script-hidden, same-site binding in this browser.
    const [binding] = (await context.cookies(APP_ORIGIN)).filter(
      (cookie) => cookie.name === BINDING_COOKIE
    );
    expect(binding).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/" });
    const newPassword = `${resetter.password}-new`;
    const changedAfter = Date.now() - 1000;
    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await page.getByLabel("Confirm password", { exact: true }).fill(newPassword);
    await page.getByRole("button", { name: "Save password" }).click();
    await expect.poll(() => guarded.reply(RESET_PATH).length, { timeout: 20_000 }).toBe(1);
    // The restored page still sends only the two passwords; the website
    // supplies the recovery session from its binding.
    expect(guarded.sentTo(RESET_PATH)[0].fields.join()).toBe("confirmPassword,password");
    expect(guarded.reply(RESET_PATH)[0]).toMatchObject({
      status: 200,
      body: { success: true, signOutComplete: true },
    });
    // Saved: the member is sent to sign in, the new password works and the
    // old one fails, and a notice of the change is emailed.
    await page.waitForURL(`${APP_ORIGIN}/login`);
    expect(await canSignIn(resetter.email, newPassword)).toBe(true);
    expect(await canSignIn(resetter.email, resetter.password)).toBe(false);
    await latestMailTo(resetter.email, { after: changedAfter });
    resetter.password = newPassword;
    // The used link's binding is gone, so it cannot complete a second reset.
    expect(
      (await context.cookies(APP_ORIGIN)).filter((cookie) => cookie.name === BINDING_COOKIE)
    ).toEqual([]);
    expectContained(guarded);
    expectNoProviderSince(mark);
  });

  test("a reset form from link A is refused once link B is opened in the same browser", async ({
    context,
    page,
  }) => {
    test.setTimeout(120_000);
    const mark = readOutboundAttempts().length;
    const guarded = await guard(context);
    // Link A opens page A; link B, asked for and opened later in another tab
    // of the same browser, replaces the recovery session.
    await openResetLink(page, guarded, resetter);
    const pageB = await context.newPage();
    await openResetLink(pageB, guarded, resetter);
    const staleAttempt = `${resetter.password}-from-link-a`;
    await page.bringToFront();
    await page.getByLabel("New password", { exact: true }).fill(staleAttempt);
    await page.getByLabel("Confirm password", { exact: true }).fill(staleAttempt);
    await page.getByRole("button", { name: "Save password" }).click();
    await expect.poll(() => guarded.reply(RESET_PATH).length, { timeout: 20_000 }).toBe(1);
    expect(guarded.reply(RESET_PATH)[0]).toEqual({
      method: "POST",
      path: RESET_PATH,
      status: 401,
      body: SESSION_CHANGED,
    });
    // Page A asks for a new link, as for any refused recovery session.
    await expect(page.getByRole("heading", { name: "Reset link expired" })).toBeVisible();
    expect(await canSignIn(resetter.email, staleAttempt)).toBe(false);
    expect(await canSignIn(resetter.email, resetter.password)).toBe(true);
    // Page B, from the latest link, still saves.
    const newPassword = `${resetter.password}-from-link-b`;
    await pageB.bringToFront();
    await pageB.getByLabel("New password", { exact: true }).fill(newPassword);
    await pageB.getByLabel("Confirm password", { exact: true }).fill(newPassword);
    await pageB.getByRole("button", { name: "Save password" }).click();
    await expect.poll(() => guarded.reply(RESET_PATH).length, { timeout: 20_000 }).toBe(2);
    expect(guarded.reply(RESET_PATH)[1]).toMatchObject({ status: 200, body: { success: true } });
    await pageB.waitForURL(`${APP_ORIGIN}/login`);
    expect(await canSignIn(resetter.email, newPassword)).toBe(true);
    expect(await canSignIn(resetter.email, resetter.password)).toBe(false);
    resetter.password = newPassword;
    expectContained(guarded);
    expectNoProviderSince(mark);
  });

  test("a known-breached password is refused on the reset page", async ({ context, page }) => {
    test.setTimeout(120_000);
    const mark = readOutboundAttempts().length;
    const guarded = await guard(context);
    await openResetLink(page, guarded, resetter);
    await page.getByLabel("New password", { exact: true }).fill(KNOWN_BREACHED_PASSWORD);
    await page.getByLabel("Confirm password", { exact: true }).fill(KNOWN_BREACHED_PASSWORD);
    await page.getByRole("button", { name: "Save password" }).click();
    await expect.poll(() => guarded.reply(RESET_PATH).length, { timeout: 20_000 }).toBe(1);
    expect(guarded.reply(RESET_PATH)[0]).toEqual({
      method: "POST",
      path: RESET_PATH,
      status: 400,
      body: BREACHED,
    });
    // The existing message, and the member stays on the form to choose another.
    await expect(toast(page, "Password reset failed")).toBeVisible();
    await expect(page.getByText(BREACHED.error).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
    expect(await canSignIn(resetter.email, KNOWN_BREACHED_PASSWORD)).toBe(false);
    expect(await canSignIn(resetter.email, resetter.password)).toBe(true);
    // The website asked the (locally answered) breach check, nothing else.
    expect(
      readOutboundAttempts()
        .slice(mark)
        .some((entry) => entry.origin === "https://api.pwnedpasswords.com")
    ).toBe(true);
    expectContained(guarded);
    expectNoProviderSince(mark);
  });

  test("saving the password the member already has completes the reset", async ({
    context,
    page,
  }) => {
    test.setTimeout(120_000);
    const mark = readOutboundAttempts().length;
    const guarded = await guard(context);
    await openResetLink(page, guarded, resetter);
    // Local Auth refuses it as the current password ("same_password"), which
    // the reset treats as already in force: done, and every session signed out.
    await page.getByLabel("New password", { exact: true }).fill(resetter.password);
    await page.getByLabel("Confirm password", { exact: true }).fill(resetter.password);
    await page.getByRole("button", { name: "Save password" }).click();
    await expect.poll(() => guarded.reply(RESET_PATH).length, { timeout: 20_000 }).toBe(1);
    expect(guarded.reply(RESET_PATH)[0]).toMatchObject({
      status: 200,
      body: { success: true, signOutComplete: true },
    });
    await page.waitForURL(`${APP_ORIGIN}/login`);
    expect(await canSignIn(resetter.email, resetter.password)).toBe(true);
    expectContained(guarded);
    expectNoProviderSince(mark);
  });

  test("a reset link's session cannot set a password without its binding", async ({
    context,
    page,
  }) => {
    test.setTimeout(120_000);
    const mark = readOutboundAttempts().length;
    const guarded = await guard(context);
    await openResetLink(page, guarded, resetter);
    // Someone holding the recovery session cookies (readable by page scripts)
    // but not the script-hidden binding.
    await context.clearCookies({ name: BINDING_COOKIE });
    const attempt = `${resetter.password}-without-binding`;
    // The profile page's password change refuses the reset link's session,
    // even with a wrong current password.
    const csrf = (await context.cookies(APP_ORIGIN)).find((cookie) => cookie.name === "vm_csrf");
    expect(csrf?.value).toMatch(/^[a-f0-9]{64}$/i);
    const changed = await page.request.post(`${APP_ORIGIN}/api/auth/change-password`, {
      headers: { origin: APP_ORIGIN, "x-csrf-token": csrf!.value },
      data: {
        currentPassword: "not-the-current-password",
        newPassword: attempt,
        confirmNewPassword: attempt,
      },
      maxRedirects: 0,
    });
    expect(changed.status()).toBe(403);
    expect(await changed.json()).toEqual(RECOVERY_SESSION);
    // Nor can it ask for a password setup link (the profile page's request).
    const setup = await page.request.post(`${APP_ORIGIN}${RECOVERY_PATH}`, {
      headers: { origin: APP_ORIGIN, "x-csrf-token": csrf!.value },
      data: { email: resetter.email },
      maxRedirects: 0,
    });
    expect(setup.status()).toBe(403);
    expect(await setup.json()).toEqual(RECOVERY_SESSION);
    // Nor does the reset page complete without the binding.
    await page.getByLabel("New password", { exact: true }).fill(attempt);
    await page.getByLabel("Confirm password", { exact: true }).fill(attempt);
    await page.getByRole("button", { name: "Save password" }).click();
    await expect.poll(() => guarded.reply(RESET_PATH).length, { timeout: 20_000 }).toBe(1);
    expect(guarded.reply(RESET_PATH)[0]).toEqual({
      method: "POST",
      path: RESET_PATH,
      status: 401,
      body: { error: "Request a new recovery link" },
    });
    await expect(page.getByRole("heading", { name: "Reset link expired" })).toBeVisible();
    expect(await canSignIn(resetter.email, attempt)).toBe(false);
    expect(await canSignIn(resetter.email, resetter.password)).toBe(true);
    expectContained(guarded);
    expectNoProviderSince(mark);
  });

  test("a reset link's token redeemed straight at local Auth opens no sensitive command", async ({
    context,
    page,
  }) => {
    test.setTimeout(120_000);
    const mark = readOutboundAttempts().length;
    const guarded = await guard(context);
    // Someone holding the reset email (not this browser's sign-in verifier)
    // redeems its token at local Auth's verify endpoint, which skips the
    // link's PKCE check and records the session as `otp`, not `recovery`.
    const sentAfter = Date.now() - 1000;
    await requestResetLink(page, guarded, resetter.email);
    const link = await authLinkFor(resetter.email, sentAfter);
    openedLinks.add(link.href);
    const copy = readTestCopy();
    const redeemed = await fetch(`${API_ORIGIN}/auth/v1/verify`, {
      method: "POST",
      redirect: "error",
      headers: { apikey: copy.publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "recovery", token_hash: link.searchParams.get("token") }),
    });
    expect(redeemed.status).toBe(200);
    const session = (await redeemed.json()) as { access_token: string; refresh_token: string };
    const amr = JSON.parse(
      Buffer.from(session.access_token.split(".")[1], "base64url").toString("utf8")
    ).amr as { method: string }[];
    expect(amr.map((entry) => entry.method)).toEqual(["otp"]);
    const cookies = await sessionCookies(copy, {
      token: session.access_token,
      refreshToken: session.refresh_token,
    });
    expect(cookies.accountId).toBe(resetter.id);
    await context.addCookies(cookies.cookies.map((cookie) => ({ ...cookie, url: APP_ORIGIN })));
    await page.goto("/");
    const csrf = (await context.cookies(APP_ORIGIN)).find((cookie) => cookie.name === "vm_csrf");
    expect(csrf?.value).toMatch(/^[a-f0-9]{64}$/i);
    const post = (pathname: string, data: unknown) =>
      page.request.post(`${APP_ORIGIN}${pathname}`, {
        headers: { origin: APP_ORIGIN, "x-csrf-token": csrf!.value },
        data,
        maxRedirects: 0,
      });
    // The website treats it like a reset link's session: no password change
    // (even with a wrong current password), no password setup link and no
    // email change, and it is not a recent sign-in.
    const attempt = `${resetter.password}-from-token`;
    const changed = await post("/api/auth/change-password", {
      currentPassword: "not-the-current-password",
      newPassword: attempt,
      confirmNewPassword: attempt,
    });
    expect(changed.status()).toBe(403);
    expect(await changed.json()).toEqual(RECOVERY_SESSION);
    const setup = await post(RECOVERY_PATH, { email: resetter.email });
    expect(setup.status()).toBe(403);
    expect(await setup.json()).toEqual(RECOVERY_SESSION);
    const moved = await post(EMAIL_CHANGE_PATH, {
      newEmail: resetter.email.replace(/^resetter-/, "taken-over-"),
    });
    expect(moved.status()).toBe(403);
    expect(await moved.json()).toEqual(EMAIL_RECOVERY_SESSION);
    expect(storedEmail(resetter.id)).toBe(`${resetter.email}|`);
    expect(await canSignIn(resetter.email, attempt)).toBe(false);
    expect(await canSignIn(resetter.email, resetter.password)).toBe(true);
    expectContained(guarded);
    expectNoProviderSince(mark);
  });

  test("a Google member with an old sign-in is asked to sign in again before Set Password", async ({
    context,
    page,
  }) => {
    test.setTimeout(120_000);
    const mark = readOutboundAttempts().length;
    const guarded = await guard(context);
    // Signed in (through local Auth) 61 minutes ago; the session is still live.
    const session = await sessionCookies(
      readTestCopy(),
      await googleMemberSession(google, 61 * 60)
    );
    expect(session.accountId).toBe(google.id);
    await context.addCookies(session.cookies.map((cookie) => ({ ...cookie, url: APP_ORIGIN })));
    await openProfileTab(page, "Security");
    await expect(
      page.getByText("Set a password so you can also sign in with email.")
    ).toBeVisible();
    await page.getByRole("button", { name: "Set Password" }).click();
    await expect.poll(() => guarded.reply(RECOVERY_PATH).length, { timeout: 20_000 }).toBe(1);
    expect(guarded.sentTo(RECOVERY_PATH)[0].fields.join()).toBe("email");
    expect(guarded.reply(RECOVERY_PATH)[0]).toEqual({
      method: "POST",
      path: RECOVERY_PATH,
      status: 403,
      body: SIGN_IN_AGAIN,
    });
    // The page shows the reason in its existing failure toast; nothing is sent.
    await expect(toast(page, "Password setup failed")).toBeVisible();
    await expect(page.getByText(SIGN_IN_AGAIN.error).first()).toBeVisible();
    expect(await mailCountTo(google.email)).toBe(0);
    expectContained(guarded);
    expectNoProviderSince(mark);
  });

  test("a Google member sets a password from the security tab", async ({ context, page }) => {
    test.setTimeout(120_000);
    const mark = readOutboundAttempts().length;
    const guarded = await guard(context);
    const googleSession = await googleMemberSession(google);
    const session = await sessionCookies(readTestCopy(), googleSession);
    expect(session.accountId).toBe(google.id);
    await context.addCookies(session.cookies.map((cookie) => ({ ...cookie, url: APP_ORIGIN })));
    await openProfileTab(page, "Security");
    // The page knows the account has no password.
    await expect(
      page.getByText("Set a password so you can also sign in with email.")
    ).toBeVisible();
    const requestedAfter = Date.now() - 1000;
    await page.getByRole("button", { name: "Set Password" }).click();
    await expect.poll(() => guarded.reply(RECOVERY_PATH).length, { timeout: 20_000 }).toBe(1);
    // The restored page sends only the email, no CAPTCHA token; the website
    // accepts it from this signed-in session with its recent sign-in.
    expect(guarded.sentTo(RECOVERY_PATH)[0].fields.join()).toBe("email");
    expect(guarded.reply(RECOVERY_PATH)[0]).toMatchObject({ status: 200, body: { ok: true } });
    await expect(toast(page, "Password setup email sent")).toBeVisible();
    // Asking changed nothing yet: the Google session is still live.
    expect(await sessionIsLive(readTestCopy(), googleSession.token)).toBe(true);
    const link = await authLinkFor(google.email, requestedAfter);
    openedLinks.add(link.href);
    await page.goto(link.href);
    await page.waitForURL(RESET_PAGE);
    await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible({
      timeout: 20_000,
    });
    // A known-breached password is refused with the existing message.
    await page.getByLabel("New password", { exact: true }).fill(KNOWN_BREACHED_PASSWORD);
    await page.getByLabel("Confirm password", { exact: true }).fill(KNOWN_BREACHED_PASSWORD);
    await page.getByRole("button", { name: "Save password" }).click();
    await expect.poll(() => guarded.reply(RESET_PATH).length, { timeout: 20_000 }).toBe(1);
    expect(guarded.reply(RESET_PATH)[0]).toMatchObject({ status: 400, body: BREACHED });
    await expect(page.getByText(BREACHED.error).first()).toBeVisible();
    // The chosen password is saved from the same form.
    const password = `Local-fixture-google-${google.id.slice(0, 8)}`;
    await page.getByLabel("New password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Save password" }).click();
    await expect.poll(() => guarded.reply(RESET_PATH).length, { timeout: 20_000 }).toBe(2);
    expect(guarded.reply(RESET_PATH)[1]).toMatchObject({
      status: 200,
      body: { success: true, signOutComplete: true },
    });
    await page.waitForURL(`${APP_ORIGIN}/login`);
    expect(await canSignIn(google.email, password)).toBe(true);
    expect(await canSignIn(google.email, KNOWN_BREACHED_PASSWORD)).toBe(false);
    // Every session was signed out, the Google session the member started from too.
    expect(await sessionIsLive(readTestCopy(), googleSession.token)).toBe(false);
    // Local Auth keeps only the Google identity (its option to add an email
    // identity on a first password is off by default, as on hosted Auth), so
    // the account looks the same; the password is in local Auth's own record.
    expect(
      queryTestCopy(
        `select string_agg(provider, ',' order by provider) || '|' || (encrypted_password <> '')::text ` +
          `from auth.identities join auth.users u on u.id = user_id where user_id = '${google.id}' group by encrypted_password;`
      )
    ).toBe("google|true");
    // Asking again from a session signed in with that password is refused.
    const signedIn = await sessionCookies(
      readTestCopy(),
      await signIn(readTestCopy(), { email: google.email, password })
    );
    await context.addCookies(signedIn.cookies.map((cookie) => ({ ...cookie, url: APP_ORIGIN })));
    const csrf = (await context.cookies(APP_ORIGIN)).find((cookie) => cookie.name === "vm_csrf");
    const again = await page.request.post(`${APP_ORIGIN}${RECOVERY_PATH}`, {
      headers: { origin: APP_ORIGIN, "x-csrf-token": csrf!.value },
      data: { email: google.email },
      maxRedirects: 0,
    });
    expect(again.status()).toBe(409);
    expect(await again.json()).toEqual({
      error: "This account already has a password. Use Change password instead.",
      code: "password_exists",
    });
    expectContained(guarded);
    expectNoProviderSince(mark);
  });

  test("an email change needs a recent sign-in and says nothing about other accounts", async ({
    context,
    page,
  }) => {
    test.setTimeout(120_000);
    const mark = readOutboundAttempts().length;
    const guarded = await guard(context);
    const newEmail = mover.email.replace(/^mover-/, "moved-");
    // Signed in with the password 61 minutes ago; the session is still live.
    const old = await sessionCookies(
      readTestCopy(),
      await signIn(readTestCopy(), mover, { signInAgeSeconds: 61 * 60 })
    );
    expect(old.accountId).toBe(mover.id);
    await context.addCookies(old.cookies.map((cookie) => ({ ...cookie, url: APP_ORIGIN })));
    const refused = await requestEmailChange(page, guarded, newEmail);
    expect(refused).toEqual({
      method: "POST",
      path: EMAIL_CHANGE_PATH,
      status: 403,
      body: EMAIL_SIGN_IN_AGAIN,
    });
    // The page shows the reason in its existing failure toast; nothing is sent.
    await expect(toast(page, "Email change failed")).toBeVisible();
    await expect(page.getByText(EMAIL_SIGN_IN_AGAIN.error).first()).toBeVisible();
    expect(storedEmail(mover.id)).toBe(`${mover.email}|`);
    expect(await mailCountTo(newEmail)).toBe(0);
    // Signed in again: an address that belongs to another account gets the
    // usual answer, and no email reaches either address.
    await context.clearCookies({ name: /^sb-/ });
    await signInBrowser(context, mover);
    const before = {
      current: await mailCountTo(mover.email),
      taken: await mailCountTo(resetter.email),
    };
    const taken = await requestEmailChange(page, guarded, resetter.email);
    expect(taken).toEqual({
      method: "POST",
      path: EMAIL_CHANGE_PATH,
      status: 200,
      body: EMAIL_CHANGE_ACCEPTED,
    });
    await expect(toast(page, "Confirmation sent")).toBeVisible();
    // Local Auth sends synchronously; leave the catcher a moment anyway.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await mailCountTo(mover.email)).toBe(before.current);
    expect(await mailCountTo(resetter.email)).toBe(before.taken);
    expect(storedEmail(mover.id)).toBe(`${mover.email}|`);
    // Probe: right after a change to a free address A (inside the minute in
    // which hosted Auth would refuse another email to this account), a taken
    // address and a free address B get the same answer, each no sooner than
    // the answer floor, with timings that do not tell them apart. Local Auth
    // waits only 1 s between emails, so here its interval never answers; the
    // website's own one-per-120-s account budget covers hosted Auth (unit
    // tested; the copy's limiter stand-in allows every request).
    const csrf = (await context.cookies(APP_ORIGIN)).find((cookie) => cookie.name === "vm_csrf");
    const timed = async (newEmail: string) => {
      const started = Date.now();
      const answer = await page.request.post(`${APP_ORIGIN}${EMAIL_CHANGE_PATH}`, {
        headers: { origin: APP_ORIGIN, "x-csrf-token": csrf!.value },
        data: { newEmail },
        maxRedirects: 0,
      });
      return { status: answer.status(), body: await answer.json(), ms: Date.now() - started };
    };
    const freeA = mover.email.replace(/^mover-/, "probe-a-");
    const freeB = mover.email.replace(/^mover-/, "probe-b-");
    const probe = {
      freeA: await timed(freeA),
      taken: await timed(resetter.email),
      freeB: await timed(freeB),
    };
    // Recorded for the report (statuses and timings only).
    const timings = JSON.stringify(
      Object.fromEntries(
        Object.entries(probe).map(([name, answer]) => [
          name,
          { status: answer.status, ms: answer.ms },
        ])
      )
    );
    test.info().annotations.push({ type: "email-change-probe", description: timings });
    process.stdout.write(`email-change-probe ${timings}\n`);
    for (const answer of Object.values(probe)) {
      expect(answer).toMatchObject({ status: 200, body: EMAIL_CHANGE_ACCEPTED });
      expect(answer.ms).toBeGreaterThanOrEqual(EMAIL_CHANGE_ANSWER_FLOOR_MS);
    }
    expect(Math.abs(probe.taken.ms - probe.freeB.ms)).toBeLessThan(2000);
    // Only the free addresses (and the current one, twice) were emailed.
    expect(await mailCountTo(freeA)).toBe(1);
    expect(await mailCountTo(freeB)).toBe(1);
    expect(await mailCountTo(resetter.email)).toBe(before.taken);
    expect(await mailCountTo(mover.email)).toBe(before.current + 2);
    // The last request replaced the pending change; nothing changed yet.
    expect(storedEmail(mover.id)).toBe(`${mover.email}|${freeB}`);
    expectContained(guarded);
    expectNoProviderSince(mark);
  });

  test("a member completes an email change after confirming both addresses", async ({
    context,
    page,
  }) => {
    test.setTimeout(120_000);
    const mark = readOutboundAttempts().length;
    const guarded = await guard(context);
    const session = await signIn(readTestCopy(), mover);
    const signedIn = await sessionCookies(readTestCopy(), session);
    expect(signedIn.accountId).toBe(mover.id);
    await context.addCookies(signedIn.cookies.map((cookie) => ({ ...cookie, url: APP_ORIGIN })));
    const newEmail = mover.email.replace(/^mover-/, "moved-");
    const before = { current: await mailCountTo(mover.email), next: await mailCountTo(newEmail) };
    const requestedAfter = Date.now() - 1000;
    const requested = await requestEmailChange(page, guarded, newEmail);
    expect(requested).toEqual({
      method: "POST",
      path: EMAIL_CHANGE_PATH,
      status: 200,
      body: EMAIL_CHANGE_ACCEPTED,
    });
    await expect(toast(page, "Confirmation sent")).toBeVisible();
    // One confirmation link to each address; nothing has changed yet.
    const current = await authLinkFor(mover.email, requestedAfter);
    const next = await authLinkFor(newEmail, requestedAfter);
    expect(current.href).not.toBe(next.href);
    expect(await mailCountTo(mover.email)).toBe(before.current + 1);
    expect(await mailCountTo(newEmail)).toBe(before.next + 1);
    expect(storedEmail(mover.id)).toBe(`${mover.email}|${newEmail}`);
    // The current address's link is accepted, but the change waits for the
    // other one: the old address still signs in, the new one does not.
    let sessions = sessionCount(mover.id);
    await openEmailChangeLink(page, current);
    expect(sessionCount(mover.id)).toBe(sessions);
    await expect(accountTab(page).getByText(mover.email, { exact: true })).toBeVisible();
    expect(storedEmail(mover.id)).toBe(`${mover.email}|${newEmail}`);
    expect(await canSignIn(mover.email, mover.password)).toBe(true);
    expect(await canSignIn(newEmail, mover.password)).toBe(false);
    // The new address's link completes it: now only the new address signs in.
    sessions = sessionCount(mover.id);
    await openEmailChangeLink(page, next);
    expect(sessionCount(mover.id)).toBe(sessions);
    await expect(accountTab(page).getByText(newEmail, { exact: true })).toBeVisible();
    expect(storedEmail(mover.id)).toBe(`${newEmail}|`);
    expect(await canSignIn(newEmail, mover.password)).toBe(true);
    expect(await canSignIn(mover.email, mover.password)).toBe(false);
    // Opening the links signed nobody in and nobody out: this browser's
    // session is the member's original one and is still live.
    expect(await sessionIsLive(readTestCopy(), session.token)).toBe(true);
    // The website's server logged no address, password or token, and the
    // route no longer reaches the retired backend.
    expect(
      serverLogMentions([
        mover.email,
        newEmail,
        mover.password,
        session.token,
        session.refreshToken,
        current.searchParams.get("token") ?? "",
        next.searchParams.get("token") ?? "",
      ])
    ).toEqual([]);
    expect(
      readServerLogEntries("legacy_client_in_foundation").filter(
        (entry) => entry.meta?.route === EMAIL_CHANGE_PATH
      )
    ).toEqual([]);
    mover.email = newEmail;
    expectContained(guarded);
    expectNoProviderSince(mark);
  });

  test("a member saves communication choices and they stay saved after a reload", async ({
    context,
    page,
  }) => {
    test.setTimeout(120_000);
    test.fail(true, SEC09);
    await characterise(SEC09, async () => {
      const mark = readOutboundAttempts().length;
      const guarded = await guard(context);
      await signInBrowser(context, chooser);
      // "Analytics": M1.7 may hide the marketing switches until consent can be
      // stored; this choice is not a marketing one.
      const openChoice = async () => {
        await page.goto("/dashboard/communication");
        await page.getByRole("tab", { name: "Preferences" }).click();
        return page.getByRole("switch", { name: "Analytics" });
      };
      const choice = await openChoice();
      await expect(choice).toHaveAttribute("aria-checked", "false");
      await choice.click();
      await expect
        .poll(() => guarded.reply(PREFERENCES_PATH, "PATCH").length, { timeout: 20_000 })
        .toBe(1);
      const saved = guarded.reply(PREFERENCES_PATH, "PATCH")[0];
      const allOff = {
        preferences: {
          marketing_email: false,
          marketing_sms: false,
          analytics: false,
          third_party_sharing: false,
        },
      };
      if (
        saved.status === 500 &&
        sameJson(saved.body, { error: "Invalid schema: public" }) &&
        guarded.sentTo(PREFERENCES_PATH, "PATCH")[0].fields.join() === "analytics"
      ) {
        // SEC-09 as recorded: the choice goes to a table of the retired
        // backend and the database's own refusal reaches the member; reading
        // hides the same failure (every choice "off"), and the email history
        // fails on every visit.
        await expect(toast(page, "Unable to update preference")).toBeVisible();
        const reloaded = await openChoice();
        await expect(reloaded).toHaveAttribute("aria-checked", "false");
        await expect.poll(() => guarded.reply(PREFERENCES_PATH, "GET").length).toBe(2);
        await expect.poll(() => guarded.reply(EMAIL_ACTIVITY_PATH, "GET").length).toBe(2);
        for (const read of guarded.reply(PREFERENCES_PATH, "GET"))
          expect(read).toMatchObject({ status: 200, body: allOff });
        for (const read of guarded.reply(EMAIL_ACTIVITY_PATH, "GET"))
          expect(read).toMatchObject({
            status: 500,
            body: { error: "Failed to load email activity" },
          });
        expectContained(guarded);
        expectNoProviderSince(mark);
        throw new KnownBreak(
          `${SEC09}: saving a communication choice fails (500) and every choice reads as off`
        );
      }
      // Promised (M1.7): saved, still on after a reload, and the email
      // history loads.
      expect(saved).toMatchObject({ status: 200 });
      const reloaded = await openChoice();
      await expect(reloaded).toHaveAttribute("aria-checked", "true");
      await expect.poll(() => guarded.reply(EMAIL_ACTIVITY_PATH, "GET").length).toBe(2);
      for (const read of guarded.reply(EMAIL_ACTIVITY_PATH, "GET")) expect(read.status).toBe(200);
      expectContained(guarded);
      expectNoProviderSince(mark);
    });
  });

  test("delete my account: the member is signed out and cannot sign in again", async ({
    context,
    page,
  }) => {
    test.setTimeout(120_000);
    test.fail(true, SEC02);
    await characterise(SEC02, async () => {
      const mark = readOutboundAttempts().length;
      const guarded = await guard(context);
      await signInBrowser(context, leaver);
      await openProfileTab(page, "Account");
      await page.getByRole("button", { name: "Delete", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Confirm account deletion" });
      await dialog.getByLabel("Current password").fill(leaver.password);
      await dialog.getByLabel("Type DELETE to confirm").fill("DELETE");
      await dialog.getByRole("button", { name: "Continue" }).click();
      await expect.poll(() => guarded.reply(DELETE_PATH).length, { timeout: 20_000 }).toBe(1);
      const deleted = guarded.reply(DELETE_PATH)[0];
      if (
        deleted.status === 500 &&
        sameJson(deleted.body, { error: "Unable to delete account right now" }) &&
        guarded.sentTo(DELETE_PATH)[0].fields.join() === "confirmation,currentPassword"
      ) {
        // SEC-02 as recorded: nothing is deleted; the account and its profile
        // stay, and the password still signs in.
        await expect(toast(page, "Account deletion failed")).toBeVisible();
        expect(
          queryTestCopy(
            `select count(*) from auth.users u join private.profiles p on p.account_id = u.id where u.id = '${leaver.id}';`
          )
        ).toBe("1");
        expect(await canSignIn(leaver.email, leaver.password)).toBe(true);
        expectContained(guarded);
        expectNoProviderSince(mark);
        throw new KnownBreak(
          `${SEC02}: the delete route fails (500) and the account stays and can still sign in`
        );
      }
      // Promised (M1.6c): deleted, signed out and sent home; the password no
      // longer signs in and the member pages send the visitor to sign in.
      expect(deleted).toMatchObject({ status: 200 });
      await expect(toast(page, "Account deleted")).toBeVisible();
      await page.waitForURL(`${APP_ORIGIN}/`);
      expect(await canSignIn(leaver.email, leaver.password)).toBe(false);
      await page.goto("/dashboard");
      await page.waitForURL((url) => url.pathname === "/login");
      expectContained(guarded);
      expectNoProviderSince(mark);
    });
  });
});
