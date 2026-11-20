import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext } from "@playwright/test";
import { E2E_FIXTURE } from "../../scripts/lib/foundation-e2e-target.mjs";
import people from "./fixture/people.json";
import {
  browserSessionCookies,
  queryTestCopy,
  readTestCopy,
  type Person,
  type SessionOptions,
} from "./support/test-copy";

// Staff "Member invitations" screen (ledger group 65), on the restored
// website in foundation mode against the private test copy:
// - an admin invites an address, sees the sign-up link to send and the new
//   row waiting to join; the database holds one open invitation for it;
// - inviting an address that already has an account is refused, with the
//   field marked;
// - withdrawing asks first, then the row shows "Withdrawn" and the
//   invitation is revoked in the database;
// - a moderator has no menu entry and the page sends them to the staff home;
// - an admin whose authenticator check is older than 12 hours is sent to
//   verify again.
// Nothing is emailed: the screen tells the admin to send the link.

const APP_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.appPort}`;
const API_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.apiPort}`;
const PAGE = "/admin/member-invitations";

test.use({ serviceWorkers: "block" });
test.describe.configure({ mode: "serial" });

const invited = `e2e-invite-${randomUUID().slice(0, 8)}@verifymzansi.test`;

/** Only the copy's website and its gateway; anything else is aborted. */
async function guard(context: BrowserContext) {
  const outside: string[] = [];
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === APP_ORIGIN || url.origin === API_ORIGIN) return route.continue();
    outside.push(url.origin);
    return route.abort("blockedbyclient");
  });
  return outside;
}

async function signInBrowser(context: BrowserContext, person: Person, options?: SessionOptions) {
  const session = await browserSessionCookies(readTestCopy(), person, options);
  await context.addCookies(session.cookies.map((cookie) => ({ ...cookie, url: APP_ORIGIN })));
}

function invitationState(email: string) {
  return queryTestCopy(
    "select coalesce((select case when revoked_at is not null then 'revoked' " +
      "when claimed_at is not null then 'used' else 'open' end " +
      `from private.member_invitations where email = '${email}'), 'none');`
  );
}

test.describe("staff member invitations", () => {
  test.afterAll(() => {
    // The invitation row only; its events stay (append-only by design).
    queryTestCopy(`delete from private.member_invitations where email = '${invited}';`);
  });

  test("an admin invites a member, is refused for an existing account, and withdraws", async ({
    context,
    page,
  }) => {
    test.setTimeout(90_000);
    const outside = await guard(context);
    await signInBrowser(context, "admin");
    await page.goto(PAGE);
    await expect(page.getByRole("heading", { level: 1, name: "Member invitations" })).toBeVisible();
    await expect(page.getByText("It never gives staff access.", { exact: false })).toBeVisible();
    await expect(page.getByRole("link", { name: "Staff roles" }).first()).toBeVisible();

    // Invite.
    const field = page.getByLabel("Email address");
    await field.fill(invited);
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    const status = page.getByRole("status").filter({ hasText: `Invited ${invited}.` });
    await expect(status).toBeVisible();
    await expect(status.getByRole("button", { name: "Copy link" })).toBeVisible();
    const row = page.getByRole("listitem").filter({ hasText: invited });
    await expect(row.getByText("Waiting to join")).toBeVisible();
    expect(invitationState(invited)).toBe("open");

    // An address that already has an account.
    const existing = people.verifiedMember.email;
    await field.fill(existing);
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("This email already has an account.");
    await expect(field).toHaveAttribute("aria-invalid", "true");

    // Withdraw, after confirming.
    await row.getByRole("button", { name: /Withdraw/ }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Withdraw this invitation?");
    await expect(dialog).toContainText(invited);
    await dialog.getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(row.getByText("Withdrawn", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: /Withdraw/ })).toHaveCount(0);
    expect(invitationState(invited)).toBe("revoked");
    expect(outside).toEqual([]);
  });

  test("a moderator has no member invitations", async ({ context, page }) => {
    const outside = await guard(context);
    await signInBrowser(context, "moderator");
    await page.goto("/admin");
    // The menu is built for the role (in the sidebar, or the menu sheet on phones).
    await expect(page.locator("#main-content")).toBeVisible();
    await expect(page.locator('a[href="/admin/member-invitations"]')).toHaveCount(0);
    await page.goto(PAGE);
    await page.waitForURL((url) => url.pathname === "/admin");
    expect(outside).toEqual([]);
  });

  test("an admin whose authenticator check is over 12 hours old verifies again", async ({
    context,
    page,
  }) => {
    const outside = await guard(context);
    await signInBrowser(context, "admin", { authenticatorAgeSeconds: 13 * 3600 });
    await page.goto(PAGE);
    await page.waitForURL((url) => url.pathname === "/staff/two-step");
    expect(outside).toEqual([]);
  });
});
