import { expect, test } from "@playwright/test";
import {
  countPublicTables,
  queryTestCopy,
  readTestCopy,
  retiredTableRead,
  rpc,
  signIn,
} from "./support/test-copy";

// Smoke test for the private test copy (M0.7): the restored website in
// foundation mode, reading the local database that was built only from
// database/foundation/, with the seeded test people and posts.
// Read in beforeAll, never at import time: listing specs must not touch the copy.
let state: ReturnType<typeof readTestCopy>;

test.describe("foundation test copy", () => {
  test.beforeAll(() => {
    state = readTestCopy();
  });

  test("the database has no tables in public, so retired-backend reads fail as they do live", async () => {
    expect(countPublicTables()).toBe(0);
    // supabase-js defaults to schema public; like production, the gateway
    // exposes only the api schema and refuses the request.
    const retired = await retiredTableRead(state, "listings");
    expect(retired.status).toBe(406);
    expect(retired.data.code).toBe("PGRST106");
  });

  test("the home showroom shows the test posts read through the foundation adapters", async ({
    page,
  }) => {
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

  test("the test people exist, staff with an authenticator app", async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "API-level account checks run once per run, in the chromium project"
    );
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
