import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readTestCopy, type TestCopy } from "./support/test-copy";

// What the website's own routes answer a visitor who is not signed in, and
// the media cache headers, in foundation mode. Moved from the stub suite
// (PORTING.md): kyc-verification, critical-flows (guardrails), auth-qa-audit
// (TC08), addon-checkout and media-cache-policy. Every request is anonymous
// and changes nothing in the test copy. Also the post link-preview image and
// the retired routes (roadmap M6.4).

type GuardedRoute = { name: string; method: "get" | "post"; path: string; data?: object };

test.describe("routes refuse visitors who are not signed in", () => {
  const guarded: GuardedRoute[] = [
    { name: "verification session start", method: "post", path: "/api/verification/session/start" },
    { name: "verification upload", method: "post", path: "/api/verification/upload" },
    { name: "location detection", method: "post", path: "/api/verification/location/detect" },
    {
      name: "manual location",
      method: "post",
      path: "/api/verification/location/manual",
      data: { province: "Gauteng", city: "Johannesburg" },
    },
    {
      name: "staff identity decision",
      method: "post",
      path: "/api/admin/verification/decide",
      data: { stepId: "test", decision: "approved" },
    },
    {
      name: "staff evidence download",
      method: "get",
      path: "/api/admin/verification/evidence?artifactId=test",
    },
  ];
  for (const { name, method, path: route, data } of guarded) {
    test(`${name} answers 401`, async ({ request }) => {
      const response =
        method === "get" ? await request.get(route) : await request.post(route, { data });
      expect(response.status()).toBe(401);
    });
  }

  test("a refused verification start names no internal detail", async ({ request }) => {
    const response = await request.post("/api/verification/session/start", { data: {} });
    expect(response.status()).toBe(401);
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    expect(body.error).toBeDefined();
    expect(body.error).not.toContain("stack");
    expect(body.error).not.toContain("Error:");
  });

  test("checkout, feature flags and reports refuse a visitor", async ({ request }) => {
    const checkout = await request.post("/api/billing/create-checkout", {
      data: { area: "MZANSI_MARKET", tier: "starter" },
    });
    expect([400, 401, 403, 422]).toContain(checkout.status());
    const adminToggle = await request.post("/api/admin/feature-flags/toggle", {
      data: { key: "kyc_v2_flow", enabled: true },
    });
    expect([401, 403]).toContain(adminToggle.status());
    const report = await request.post("/api/reports", { data: {} });
    expect([400, 401, 403]).toContain(report.status());
  });

  test("the identity provider webhook refuses an empty payload", async ({ request }) => {
    const response = await request.post("/api/webhooks/kyc/provider", { data: {} });
    expect(response.status()).toBe(400);
  });

  // The routes must be in the build: a missing route (404) or method (405)
  // broke feature-listing checkout once.
  for (const name of ["featured", "urgent", "boost"]) {
    test(`the ${name} add-on route exists`, async ({ request }) => {
      const response = await request.post(`/api/listings/${randomUUID()}/${name}`);
      expect(response.status()).not.toBe(404);
      expect(response.status()).not.toBe(405);
    });
  }
});

test.describe("media cache policy", () => {
  // Exercises the real Next.js header pipeline, not just the route handler.
  // The copy serves media from public/e2e-media (git-ignored, emptied by `down`).
  const stem = `audit-cache-${randomUUID()}`;
  const key = `media/${stem}.jpg`;
  const localFile = path.join(process.cwd(), "public", "e2e-media", key);
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

  test.beforeAll(async () => {
    await mkdir(path.dirname(localFile), { recursive: true });
    await writeFile(localFile, bytes);
  });

  test.afterAll(async () => {
    await unlink(localFile);
  });

  test("an existing media object is cached for a year and sets no cookie", async ({ request }) => {
    const response = await request.get(`/api/media/serve/${key}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(response.headers()["set-cookie"]).toBeUndefined();
    expect(await response.body()).toEqual(bytes);
  });

  test("a responsive fallback is cached briefly so a generated size can replace it", async ({
    request,
  }) => {
    const response = await request.get(`/api/media/serve/media/${stem}.w400.webp`);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("public, max-age=300, s-maxage=300");
    expect(await response.body()).toEqual(bytes);
  });

  test("missing objects, rejected keys and private routes are not cached", async ({ request }) => {
    const missing = await request.get(`/api/media/serve/media/${stem}-missing.jpg`);
    expect(missing.status()).toBe(404);
    expect(missing.headers()["cache-control"]).toContain("no-store");
    const rejected = await request.get(`/api/media/serve/private/${stem}.jpg`);
    expect(rejected.status()).toBe(400);
    expect(rejected.headers()["cache-control"]).toContain("no-store");
    const notifications = await request.get("/api/notifications");
    expect(notifications.status()).toBe(401);
    expect(notifications.headers()["cache-control"]).toContain("no-store");
  });
});

test.describe("post link preview", () => {
  // Seeded live posts (fixture/posts.json) and the link type their pages share.
  const LINKS = [
    { title: "Fixture Mzansi Motor Workshop", type: "business" },
    { title: "Fixture Soweto Craft Market", type: "promotion" },
  ];
  let posts: TestCopy["posts"];
  const idOf = (title: string) => {
    const id = posts.find((post) => post.title === title)?.id;
    expect(id, title).toBeTruthy();
    return id!;
  };

  test.beforeAll(() => {
    posts = readTestCopy().posts;
  });

  for (const link of LINKS) {
    test(`a shared ${link.type} link shows a PNG card`, async ({ request }) => {
      const response = await request.get(`/api/share-preview/${link.type}/${idOf(link.title)}`);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toBe("image/png");
      expect(response.headers()["cache-control"]).toBe("public, max-age=300, s-maxage=300");
      expect((await response.body()).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    });
  }

  test("an unknown post, or a post under another link type, has no card", async ({ request }) => {
    const business = idOf("Fixture Mzansi Motor Workshop");
    for (const path of [
      `/api/share-preview/listing/${randomUUID()}`,
      `/api/share-preview/listing/${business}`,
      `/api/share-preview/promotion/${business}`,
    ]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(404);
      expect(response.headers()["cache-control"], path).toBe("no-store");
    }
  });
});

// /api/otp/health is gone too, but sits under the signed-in /api/otp prefix,
// so a visitor gets 401 there before any route is looked up.
test.describe("retired routes are gone", () => {
  for (const path of ["/api/media/upload-url", "/api/media/upload-complete"]) {
    test(`${path} answers 404`, async ({ request }) => {
      expect((await request.get(path)).status()).toBe(404);
    });
  }
});
