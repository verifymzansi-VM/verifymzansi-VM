import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { expect, test, type Response } from "@playwright/test";
import reference from "../../src/lib/domains/taxonomy/reference.json";
import {
  queryTestCopy,
  readTestCopy,
  rpc,
  serviceRpc,
  signIn,
  type TestCopy,
} from "./support/test-copy";

// Roadmap M4.1: a video post is recognised as a video and can be played and
// skipped through. The seller posts a free event with a cover photo and a
// short video through the production commands; a moderator approves it. The
// live backend names media `media/<uuid>` with no file extension, so the card
// must take "video" from the post's media and the media route must answer byte
// ranges by the stored type.
//
// The roadmap names a mobile-safari project. This config has none (WebKit is
// not installed in CI), so the spec runs in the phone project mobile-chrome and
// in chromium; it uses no Chromium-only API, so it can run under WebKit later.

const VIDEO_FIXTURE = path.join("public", "video", "advert-browsing", "market-motion.webm");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MEDIA_KEY = /^media\/[0-9a-f-]{36}$/;

test.use({ serviceWorkers: "block" });

async function command(copy: TestCopy, name: string, body: unknown, token?: string) {
  const result = await rpc(copy, name, body, token);
  if (result.status !== 200)
    throw new Error(`Command ${name} answered ${result.status}: ${JSON.stringify(result.data)}`);
  return result.data;
}

/** Stores bytes where the copy's website serves media (as the seed does). */
function storeMediaFile(key: string, bytes: Buffer) {
  if (!MEDIA_KEY.test(key)) throw new Error("Unexpected media key");
  const file = path.join("public", "e2e-media", ...key.split("/"));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  return file;
}

/** A finished upload: reserve as the owner, store the bytes, attest as the service. */
async function upload(
  copy: TestCopy,
  token: string,
  kind: "image" | "video",
  bytes: Buffer,
  mime: string,
  files: string[],
  size?: { width: number; height: number }
) {
  const reserved = (await command(
    copy,
    "begin_media_upload",
    { p_kind: kind, p_bytes: bytes.length },
    token
  )) as { object_id: string; object_key: string };
  files.push(storeMediaFile(reserved.object_key, bytes));
  const finalized = await serviceRpc("finalize_media", {
    p_object_id: reserved.object_id,
    p_size: bytes.length,
    p_sha256: createHash("sha256").update(bytes).digest("hex"),
    p_mime: mime,
    ...(size ? { p_width: size.width, p_height: size.height } : {}),
  });
  expect(finalized.status).toBe(200);
  return { id: reserved.object_id, key: reserved.object_key };
}

/** Publishes a free event with a cover photo and a video; returns its ids. */
async function publishVideoEvent(
  copy: TestCopy,
  title: string,
  created: string[],
  files: string[]
) {
  const owner = await signIn(copy, "verifiedMember");
  const activity = reference.activities.find((row) => row.category === "events");
  if (!activity) throw new Error("The taxonomy has no event activity");
  let post = (await command(
    copy,
    "create_core_draft",
    {
      p_kind: "event",
      p_area: "tourism_events",
      p_category_key: "events",
      p_activity_key: activity.key,
      p_detail: {
        contact_channels: ["form"],
        starts_at: new Date(Date.now() - 60_000).toISOString(),
        ends_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        timezone: "Africa/Johannesburg",
      },
    },
    owner.token
  )) as { id: string; revision: number };
  expect(post.id).toMatch(UUID);
  created.push(post.id);
  post = (await command(
    copy,
    "save_post_content",
    {
      p_post_id: post.id,
      p_expected_revision: post.revision,
      p_content: {
        title,
        description: "Synthetic event with a video, used by the foundation browser tests.",
        province_id: "gp",
        city_id: "gp_johannesburg",
      },
    },
    owner.token
  )) as { id: string; revision: number };

  const cover = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "#0b6e4f" },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
  const photo = await upload(copy, owner.token, "image", cover, "image/jpeg", files, {
    width: 800,
    height: 600,
  });
  const clip = readFileSync(VIDEO_FIXTURE);
  const video = await upload(copy, owner.token, "video", clip, "video/webm", files);
  post = (await command(
    copy,
    "set_post_media",
    {
      p_post_id: post.id,
      p_expected_revision: post.revision,
      p_items: [
        { object_id: photo.id, purpose: "cover", position: 0 },
        { object_id: video.id, purpose: "video", position: 0 },
      ],
    },
    owner.token
  )) as { id: string; revision: number };
  post = (await command(
    copy,
    "submit_post",
    { p_post_id: post.id, p_expected_revision: post.revision },
    owner.token
  )) as { id: string; revision: number };

  const moderator = await signIn(copy, "moderator");
  const lease = (await command(
    copy,
    "claim_queue_item",
    { p_subject: "post", p_id: post.id },
    moderator.token
  )) as { claim_generation: number; claim_nonce: string };
  await command(
    copy,
    "moderate_post",
    {
      p_post_id: post.id,
      p_expected_revision: post.revision,
      p_decision: "approve",
      p_reason: null,
      p_claim_generation: lease.claim_generation,
      p_claim_nonce: lease.claim_nonce,
    },
    moderator.token
  );
  expect(queryTestCopy(`select status from private.posts where id = '${post.id}';`)).toBe("live");
  return { id: post.id, photo, video };
}

/** Leaves the seller's events as seeded for the other specs. */
async function deleteEvent(copy: TestCopy, postId: string) {
  const owner = await signIn(copy, "verifiedMember");
  await command(
    copy,
    "execute_my_frontend_post_action",
    {
      p_request: randomUUID(),
      p_post: postId,
      p_expected_revision: Number(
        queryTestCopy(`select revision from private.posts where id = '${postId}';`)
      ),
      p_action: "delete",
      p_kind: "event",
      p_area: "tourism_events",
    },
    owner.token
  );
}

test.describe("Video posts", () => {
  test("show as videos and can be played and skipped through", async ({ page, request }) => {
    test.setTimeout(120_000);
    const copy = readTestCopy();
    const title = `Fixture Video Evening ${randomUUID().slice(0, 8)}`;
    const created: string[] = [];
    const files: string[] = [];
    let passed = false;
    try {
      const event = await publishVideoEvent(copy, title, created, files);
      const size = readFileSync(VIDEO_FIXTURE).length;
      const videoPath = `/api/media/serve/${event.video.key}`;

      await test.step("the media route answers byte ranges by the stored type", async () => {
        const part = await request.get(videoPath, { headers: { Range: "bytes=0-1023" } });
        expect(part.status()).toBe(206);
        expect(part.headers()["content-range"]).toBe(`bytes 0-1023/${size}`);
        expect(part.headers()["accept-ranges"]).toBe("bytes");
        expect(part.headers()["content-type"]).toBe("video/webm");
        expect((await part.body()).length).toBe(1024);

        const tail = await request.get(videoPath, { headers: { Range: "bytes=-500" } });
        expect(tail.status()).toBe(206);
        expect(tail.headers()["content-range"]).toBe(`bytes ${size - 500}-${size - 1}/${size}`);

        const refused = await request.get(videoPath, { headers: { Range: `bytes=${size}-` } });
        expect(refused.status()).toBe(416);
        expect(refused.headers()["content-range"]).toBe(`bytes */${size}`);
        expect(refused.headers()["cache-control"]).toBe("private, no-store");

        const whole = await request.get(videoPath);
        expect(whole.status()).toBe(200);
        expect(whole.headers()["accept-ranges"]).toBe("bytes");
        expect((await whole.body()).length).toBe(size);

        // The cover photo is served whole, as before.
        const photo = await request.get(`/api/media/serve/${event.photo.key}`, {
          headers: { Range: "bytes=0-1023" },
        });
        expect(photo.status()).toBe(200);
        expect(photo.headers()["content-type"]).toBe("image/jpeg");
      });

      const mediaReplies: Response[] = [];
      page.on("response", (response) => {
        if (new URL(response.url()).pathname === videoPath) mediaReplies.push(response);
      });

      // The grid's card (the showroom above it uses the "hero" variant).
      const card = page.locator('[data-card-variant="showcase"]').filter({ hasText: title });
      const video = card.locator("video");
      await test.step("the event's card is a video tile", async () => {
        // No autoplay: the visitor starts the video, as on a phone with reduced motion.
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto("/tourism-events?tab=events&type=event", {
          waitUntil: "domcontentloaded",
        });
        await expect(card).toHaveCount(1);
        await card.evaluate((element) => element.scrollIntoView({ block: "center" }));
        await expect(video).toHaveCount(1);
        await expect(card.getByRole("button", { name: "Play video", exact: true })).toBeVisible();
      });

      await test.step("it plays", async () => {
        await video.evaluate((element: HTMLVideoElement) => {
          element.muted = true;
        });
        await card.getByRole("button", { name: "Play video", exact: true }).click();
        await expect
          .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), {
            timeout: 20_000,
          })
          .toBeGreaterThan(0.2);
        expect(await video.evaluate((element: HTMLVideoElement) => element.currentSrc)).toContain(
          videoPath
        );
        // The browser fetched the video in parts (206), not as one opaque file.
        await expect.poll(() => mediaReplies.map((reply) => reply.status())).toContain(206);
      });

      await test.step("it skips forward", async () => {
        const duration = await video.evaluate((element: HTMLVideoElement) => element.duration);
        expect(Number.isFinite(duration)).toBe(true);
        expect(duration).toBeGreaterThan(2);
        const target = Math.round(duration * 0.75 * 10) / 10;
        const seekable = await video.evaluate((element: HTMLVideoElement) =>
          element.seekable.length ? element.seekable.end(element.seekable.length - 1) : 0
        );
        expect(seekable).toBeGreaterThanOrEqual(target);
        await video.evaluate(
          (element: HTMLVideoElement, to: number) =>
            new Promise<void>((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error("seek timed out")), 15_000);
              element.addEventListener(
                "seeked",
                () => {
                  clearTimeout(timer);
                  resolve();
                },
                { once: true }
              );
              element.currentTime = to;
            }),
          target
        );
        const position = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
        expect(position).toBeGreaterThanOrEqual(target - 0.5);
        expect(position).toBeLessThanOrEqual(duration);
        // Playback continues from the new position.
        await expect
          .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), {
            timeout: 10_000,
          })
          .toBeGreaterThan(position);
        expect(mediaReplies.every((reply) => reply.status() === 206)).toBe(true);
      });
      passed = true;
    } finally {
      // Leave the copy as seeded; a cleanup failure must not hide the test's own error.
      try {
        for (const id of created) {
          if (queryTestCopy(`select count(*) from private.posts where id = '${id}';`) === "1")
            await deleteEvent(copy, id);
        }
      } catch (error) {
        if (passed) throw error;
        console.warn("Video event cleanup failed after a test failure", error);
      } finally {
        for (const file of files) rmSync(file, { force: true });
      }
    }
  });
});
