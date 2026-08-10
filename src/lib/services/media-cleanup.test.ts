import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import {
  collectMediaUrls,
  diffRemovedMediaUrls,
  queuePublicMediaCleanup,
} from "@/lib/services/media-cleanup";

describe("media cleanup helpers", () => {
  it("collects and diffs media URLs deterministically", () => {
    const previous = collectMediaUrls(
      "https://media.verifymzansi.com/listings/old-photo.jpg",
      ["https://media.verifymzansi.com/listings/old-video.mp4"],
      null,
      undefined,
      ""
    );
    const next = collectMediaUrls("https://media.verifymzansi.com/listings/new-photo.jpg", [
      "https://media.verifymzansi.com/listings/old-video.mp4",
    ]);

    expect(diffRemovedMediaUrls(previous, next)).toEqual([
      "https://media.verifymzansi.com/listings/old-photo.jpg",
    ]);
  });

  it("queues only trusted public media keys and deduplicates them", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const admin = {
      from: vi.fn().mockReturnValue({ insert }),
    };

    const queued = await queuePublicMediaCleanup(
      admin,
      [
        "https://media.verifymzansi.com/listings/old-photo.jpg",
        "https://media.verifymzansi.com/listings/old-photo.jpg",
        "https://media.verifymzansi.com/media/listing/user-1/old-video.mp4",
        "https://evil.example.com/not-ours.jpg",
      ],
      "listing_media_replaced"
    );

    // The image expands to its derived responsive variants; the video does not.
    expect(queued).toEqual([
      "listings/old-photo.jpg",
      "listings/old-photo.w400.webp",
      "listings/old-photo.w800.webp",
      "listings/old-photo.w1600.webp",
      "media/listing/user-1/old-video.mp4",
    ]);
    expect(insert).toHaveBeenCalledWith([
      {
        bucket: "public",
        r2_key: "listings/old-photo.jpg",
        reason: "listing_media_replaced",
      },
      {
        bucket: "public",
        r2_key: "listings/old-photo.w400.webp",
        reason: "listing_media_replaced",
      },
      {
        bucket: "public",
        r2_key: "listings/old-photo.w800.webp",
        reason: "listing_media_replaced",
      },
      {
        bucket: "public",
        r2_key: "listings/old-photo.w1600.webp",
        reason: "listing_media_replaced",
      },
      {
        bucket: "public",
        r2_key: "media/listing/user-1/old-video.mp4",
        reason: "listing_media_replaced",
      },
    ]);
  });
});
