import { expect, test } from "@playwright/test";
import {
  countPublicTables,
  queryTestCopy,
  readTestCopy,
  retiredTableRead,
  rpc,
  signIn,
} from "./support/test-copy";
import {
  isStagingTarget,
  readStagingTarget,
  stagingRetiredTableRead,
  stagingRpc,
  type StagingTarget,
} from "./support/staging-target";

// Smoke test for the private test copy (M0.7): the restored website in
// foundation mode, reading the local database that was built only from
// database/foundation/, with the seeded test people and posts.
// Read in beforeAll, never at import time: listing specs must not touch the copy.
//
// The release workflow also runs it against the hosted staging copy (M0.15b,
// playwright.staging.config.ts) right after deploying it. Staging has no
// trusted database access and no seeded test people or posts, so there it
// checks only what any visitor can see: the gateway, the public catalogue and
// the home page, served from staging and never from production.
const staging = isStagingTarget();
let state: ReturnType<typeof readTestCopy>;
let stagingTarget: StagingTarget;

test.describe("foundation test copy", () => {
  test.beforeAll(() => {
    if (staging) stagingTarget = readStagingTarget();
    else state = readTestCopy();
  });

  test("the database has no tables in public, so retired-backend reads fail as they do live", async () => {
    if (!staging) expect(countPublicTables()).toBe(0);
    // supabase-js defaults to schema public; like production, the gateway
    // exposes only the api schema and refuses the request.
    const retired = staging
      ? await stagingRetiredTableRead(stagingTarget, "listings")
      : await retiredTableRead(state, "listings");
    expect(retired.status).toBe(406);
    expect(retired.data.code).toBe("PGRST106");
  });

  // Registered only against staging, so the local run has nothing to skip.
  if (staging)
    test("the staging home page is served from the staging copy, never production", async ({
      page,
    }) => {
      // The public command the home showroom calls answers anonymously.
      const cards = await stagingRpc(stagingTarget, "search_post_cards", {
        p_request: { limit: 24 },
      });
      expect(cards.status).toBe(200);
      expect(Array.isArray(cards.data.items)).toBe(true);

      const response = await page.goto("/");
      expect(response?.status()).toBeLessThan(400);
      // Staging stays out of search results.
      expect(response?.headers()["x-robots-tag"]).toContain("noindex");
      const robots = await page.request.get("/robots.txt");
      expect(await robots.text()).toMatch(/Disallow: \/\s*$/m);
      // The browser bundle was built for the staging project.
      await expect(page.locator("#vmz-public-config")).toHaveAttribute(
        "data-supabase-url",
        stagingTarget.apiUrl
      );
      const html = await page.content();
      expect(html).not.toContain("gntzjtuncsyefujajmjy");
      expect(html).not.toContain("media.verifymzansi.com");
      const items = cards.data.items as { title: string }[];
      if (items.length > 0) {
        const showroom = page.locator("section", { has: page.locator("#home-showroom-title") });
        await expect(showroom.getByText(items[0].title).first()).toBeAttached();
      }
    });

  test("the home showroom shows the test posts read through the foundation adapters", async ({
    page,
  }) => {
    test.skip(staging, "Needs the local test copy's seeded posts");
    const titles = state.posts.map((post) => post.title);
    expect(titles.length).toBeGreaterThan(0);
    // The same public command the home showroom calls (search_post_cards).
    const cards = await rpc(state, "search_post_cards", { p_request: { limit: 24 } });
    expect(cards.status).toBe(200);
    expect(cards.data.items.map((item: { title: string }) => item.title)).toEqual(
      expect.arrayContaining(titles)
    );

    await page.goto("/");
    const showroom = page.locator("section", {
      has: page.locator("#home-showroom-title"),
    });
    for (const title of titles) await expect(showroom.getByText(title).first()).toBeAttached();
    await expect(showroom.getByText(titles[0]).first()).toBeVisible();
    // The cover image is served from the copy, not from production media.
    const image = showroom.locator(`img[src*="${state.posts[0].mediaKey}"]`).first();
    await expect(image).toBeAttached();
    expect(await image.getAttribute("src")).not.toContain("media.verifymzansi.com");
  });

  test("the home showroom's front post card is a comfortable tap target", async ({ page }) => {
    // Moved from mobile-ux-smoke.spec.ts, whose source-mode harness has no
    // posts in the home showroom. The carousel has no dot controls and its
    // arrows show only on wide screens, so on a phone the front card is the
    // control.
    test.skip(staging, "Needs the local test copy's seeded posts");
    await page.goto("/");
    const showroom = page.locator("section", {
      has: page.locator("#home-showroom-title"),
    });
    const activeCard = showroom.locator('[data-showroom-layer="active"]').first();
    await expect(activeCard).toBeAttached();
    const cardLink = activeCard.locator("xpath=descendant-or-self::a[@href][1]");
    await cardLink.scrollIntoViewIfNeeded();
    await expect(cardLink).toBeVisible();
    const box = await cardLink.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test("the test people exist, staff with an authenticator app", async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "API-level account checks run once per run, in the chromium project"
    );
    // Staging has no test people: their passwords are in this public repository.
    test.skip(staging, "Needs the local test copy's test people");
    // Visitor: no account; the public catalogue answers anonymously.
    const anonymous = await rpc(state, "get_current_posting_terms", {});
    expect(anonymous.status).toBe(200);

    const context = async (key: "invitedMember" | "verifiedMember" | "moderator" | "admin") => {
      const session = await signIn(state, key);
      const result = await rpc(state, "get_my_account_context", {}, session.token);
      expect(result.status).toBe(200);
      return { session, context: result.data };
    };

    const invited = await context("invitedMember");
    expect(invited.context.staff).toBeNull();
    expect(invited.context.profile.identity_verified).toBe(false);
    expect(
      queryTestCopy(
        `select count(*) from private.owner_admin_invitations where claimed_by is null and revoked_at is not null and email='${invited.context.email}';`
      )
    ).toBe("1");

    const verified = await context("verifiedMember");
    expect(verified.context.staff).toBeNull();
    expect(verified.context.profile.identity_verified).toBe(true);
    expect(verified.context.profile.legal_name_locked).toBe(true);

    for (const role of ["moderator", "admin"] as const) {
      const staff = await context(role);
      // The code was computed in the test from the authenticator secret.
      expect(staff.session.aal).toBe("aal2");
      expect(staff.context.totp_enrolled).toBe(true);
      expect(staff.context.staff).toMatchObject({ role, can_access: true });
    }
  });
});
