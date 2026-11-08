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
  readTestCopy,
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
//   - a member changes the sign-in email (both addresses confirm);
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
// Three steps are broken today and are marked test.fail(), each pinned to its
// exact known symptom (characterise, support/known-break.ts); any other
// outcome turns the run red:
// - "... email change ...": SEC-03, fixed by M1.5. The email change route
//   reads a table of the retired backend and answers 500 before local Auth is
//   asked; nothing changes and no confirmation is sent.
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
// signs in through a one-time local Auth link (support/google-member.ts).

const APP_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.appPort}`;
const API_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.apiPort}`;
const SEC03_EMAIL = "SEC-03 (email change), fixed by M1.5";
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
      await again.goto(link.href);
      await again.waitForURL(
        (url) =>
          url.origin === APP_ORIGIN &&
          url.pathname === "/forgot-password" &&
          url.search === "?error=recovery_failed"
      );
      expect(new URL(again.url()).hash).toContain("error_code=otp_expired");
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

  test("a member completes an email change after confirming both addresses", async ({
    context,
    page,
  }) => {
    test.setTimeout(120_000);
    test.fail(true, SEC03_EMAIL);
    await characterise(SEC03_EMAIL, async () => {
      const mark = readOutboundAttempts().length;
      const guarded = await guard(context);
      await signInBrowser(context, mover);
      const newEmail = mover.email.replace(/^mover-/, "moved-");
      const mailBefore = await mailCountTo(mover.email);
      await openProfileTab(page, "Account");
      await page.getByRole("button", { name: "Change" }).click();
      await page.getByPlaceholder("New email address").fill(newEmail);
      const requestedAfter = Date.now() - 1000;
      await page.getByRole("button", { name: "Send confirmation" }).click();
      await expect.poll(() => guarded.reply(EMAIL_CHANGE_PATH).length, { timeout: 20_000 }).toBe(1);
      const requested = guarded.reply(EMAIL_CHANGE_PATH)[0];
      if (
        requested.status === 500 &&
        sameJson(requested.body, { error: "Internal server error" }) &&
        guarded.sentTo(EMAIL_CHANGE_PATH)[0].fields.join() === "newEmail"
      ) {
        // SEC-03 as recorded: the route fails before local Auth is asked, so
        // nothing changes and no confirmation is sent to either address.
        await expect(toast(page, "Email change failed")).toBeVisible();
        expect(storedEmail(mover.id)).toBe(`${mover.email}|`);
        expect(await mailCountTo(newEmail)).toBe(0);
        expect(await mailCountTo(mover.email)).toBe(mailBefore);
        expectContained(guarded);
        expectNoProviderSince(mark);
        throw new KnownBreak(
          `${SEC03_EMAIL}: the email change route fails (500) before a confirmation is sent`
        );
      }
      // Promised (M1.5): the current and the new address each get a
      // confirmation; once both are opened, the new address signs in and the
      // old one no longer does.
      expect(requested).toMatchObject({ status: 200 });
      await expect(toast(page, "Confirmation sent")).toBeVisible();
      for (const address of [mover.email, newEmail])
        await page.goto((await authLinkFor(address, requestedAfter)).href);
      await expect.poll(() => storedEmail(mover.id)).toBe(`${newEmail}|`);
      expect(await canSignIn(newEmail, mover.password)).toBe(true);
      expect(await canSignIn(mover.email, mover.password)).toBe(false);
      expectContained(guarded);
      expectNoProviderSince(mark);
    });
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
