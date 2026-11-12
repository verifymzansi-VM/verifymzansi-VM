import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createFoundationPublicApi } from "@/lib/foundation/public-api";
import { createFoundationAuthenticatedApi } from "@/lib/foundation/authenticated-api";
import {
  readRestoredCollection,
  readRestoredPublicDetail,
  restoredPublicRow,
  type PublicCollection,
} from "@/lib/foundation/marketplace-read";
import {
  listRestoredOwnerPosts,
  restoredOwnerPostRow,
} from "@/lib/foundation/restored-owner-posts";
import { readFoundationAccountContext } from "@/lib/foundation/account-context";
import {
  presentedDashboardProfile,
  readFoundationOwnerDashboard,
} from "@/lib/foundation/owner-dashboard";
import { restoredAccountProfile } from "@/lib/foundation/restored-profile";
import {
  ACCOUNT_PROFILE_CONTRACT,
  DASHBOARD_PROFILE_CONTRACT,
  OWNER_POST_CONTRACT,
  PUBLIC_CARD_CONTRACT,
  PUBLIC_DETAIL_CONTRACT,
  checkScreenRow,
  type ScreenContract,
} from "@/test/contracts/screen-data";
import { E2E_FIXTURE } from "../../scripts/lib/foundation-e2e-target.mjs";
import { readTestCopy, signIn, type TestCopy } from "./support/test-copy";

// Roadmap M6.6: one contract test per restored screen data shape, on the live
// backend. The restored adapters read the local test copy through the same
// production API commands the website calls, and every row they shape must
// keep its contract (src/test/contracts/screen-data.ts): each field is a
// backend fact, an optional fact, or declared not available with the
// placeholder the screen has always received. A field an adapter blanks
// without declaring it, or a fact the backend stops providing, fails here.
// Reads only; nothing in the copy changes.

const connection = (copy: TestCopy) => ({
  url: `http://127.0.0.1:${E2E_FIXTURE.apiPort}`,
  expectedProjectRef: E2E_FIXTURE.projectRef,
  publishableKey: copy.publishableKey,
});

function expectContract(contract: ScreenContract, rows: object[]) {
  const problems = rows.flatMap((row) => checkScreenRow(contract, row as Record<string, unknown>));
  expect(problems, `${contract.name} contract`).toEqual([]);
}

let copy: TestCopy;

test.describe("restored screen data shapes on the live backend", () => {
  test.beforeAll(() => {
    copy = readTestCopy();
    expect(copy.posts.length).toBeGreaterThanOrEqual(3);
  });

  test("showroom cards keep the public card contract", async () => {
    const api = createFoundationPublicApi(connection(copy));
    const titles: string[] = [];
    for (const collection of ["listings", "businesses", "promotions"] as PublicCollection[]) {
      const { rows } = await readRestoredCollection(api, collection, new URLSearchParams());
      expectContract(PUBLIC_CARD_CONTRACT, rows);
      titles.push(...rows.map((row) => row.title));
    }
    for (const post of copy.posts) expect(titles).toContain(post.title);
  });

  test("post pages keep the public page contract", async () => {
    const api = createFoundationPublicApi(connection(copy));
    const rows = [];
    for (const post of copy.posts) {
      const detail = await readRestoredPublicDetail(api, post.id);
      expect(detail, post.title).not.toBeNull();
      const row = restoredPublicRow(detail!, detail!);
      // Optional facts every seeded post has: an optional field the adapter
      // started blanking would pass the contract, so check them here.
      expect(row.cover_photo, post.title).toContain(post.mediaKey);
      expect(row.photos.join(" "), post.title).toContain(post.mediaKey);
      expect(row.media_width, post.title).toBeGreaterThan(0);
      expect(row.media_height, post.title).toBeGreaterThan(0);
      expect(row.contact_methods.length, post.title).toBeGreaterThan(0);
      if (detail!.kind === "event") {
        expect(row.start_date, post.title).toBeTruthy();
        expect(row.end_date, post.title).toBeTruthy();
      }
      rows.push(row);
    }
    expectContract(PUBLIC_DETAIL_CONTRACT, rows);
    // The craft market offers a call as well as the enquiry form (fixture).
    const market = rows.find((row) => row.title === "Fixture Soweto Craft Market");
    expect(market?.contact_methods).toEqual(expect.arrayContaining(["call", "form"]));
  });

  test("the owner's posts keep the owner post contract", async () => {
    const { token } = await signIn(copy, "verifiedMember");
    const api = createFoundationAuthenticatedApi(connection(copy), token);
    const account = await readFoundationAccountContext(api);
    const rows = [];
    for (const kind of ["listing", "business", "event"] as const)
      for (const post of await listRestoredOwnerPosts(api, kind))
        rows.push(restoredOwnerPostRow(post, account.account_id));
    expectContract(OWNER_POST_CONTRACT, rows);
    for (const post of copy.posts) expect(rows.map((row) => row.id)).toContain(post.id);
  });

  test("the member's profile keeps the account and dashboard profile contracts", async () => {
    const { token } = await signIn(copy, "verifiedMember");
    const api = createFoundationAuthenticatedApi(connection(copy), token);
    const auth = createClient(connection(copy).url, copy.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await auth.auth.getUser(token);
    expect(error).toBeNull();
    const account = await readFoundationAccountContext(api);
    const dashboard = await readFoundationOwnerDashboard(api, account.account_id);
    expectContract(ACCOUNT_PROFILE_CONTRACT, [
      restoredAccountProfile(account, data.user!, dashboard.verification),
    ]);
    const profile = presentedDashboardProfile(dashboard, account, data.user!);
    expectContract(DASHBOARD_PROFILE_CONTRACT, [profile]);
    // The verified member confirmed a locality, which the dashboard read provides.
    expect(profile.location_province).toBeTruthy();
  });
});
