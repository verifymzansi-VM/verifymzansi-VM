import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

// Exercise the real Next.js header pipeline, not just the route handler.
const stem = `audit-cache-${randomUUID()}`;
const key = `media/${stem}.jpg`;
const localFile = path.join(process.cwd(), "public", "e2e-media", key);
const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

test.describe("Media cache policy", () => {
  test.beforeAll(async () => {
    await mkdir(path.dirname(localFile), { recursive: true });
    await writeFile(localFile, bytes);
  });

  test.afterAll(async () => {
    await unlink(localFile);
  });

  test("@smoke caches an existing media object and sends no session cookie", async ({
    request,
  }) => {
    const response = await request.get(`/api/media/serve/${key}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(response.headers()["set-cookie"]).toBeUndefined();
    expect(await response.body()).toEqual(bytes);
  });

  test("@smoke briefly caches a responsive fallback so a generated variant can replace it", async ({
    request,
  }) => {
    const response = await request.get(`/api/media/serve/media/${stem}.w400.webp`);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("public, max-age=300, s-maxage=300");
    expect(await response.body()).toEqual(bytes);
  });

  test("@smoke does not cache a missing media object", async ({ request }) => {
    const response = await request.get(`/api/media/serve/media/${stem}-missing.jpg`);
    expect(response.status()).toBe(404);
    expect(response.headers()["cache-control"]).toContain("no-store");
  });

  test("@smoke does not cache a rejected media key", async ({ request }) => {
    const response = await request.get(`/api/media/serve/private/${stem}.jpg`);
    expect(response.status()).toBe(400);
    expect(response.headers()["cache-control"]).toContain("no-store");
  });

  test("@smoke keeps other API routes private", async ({ request }) => {
    const response = await request.get("/api/notifications");
    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toContain("no-store");
  });
});
