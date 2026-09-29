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

  function createCleanupAdmin(ownedKeys: string[]) {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const ownershipIn = vi.fn().mockResolvedValue({
      data: ownedKeys.map((r2_key) => ({ r2_key })),
      error: null,
    });
    const ownershipEq = vi.fn().mockReturnValue({ in: ownershipIn });
    const admin = {
      from: vi.fn().mockReturnValue({
        insert,
        select: vi.fn().mockReturnValue({ eq: ownershipEq }),
      }),
    };
    return { admin, insert, ownershipEq, ownershipIn };
  }

  it("queues only trusted public media keys and deduplicates them", async () => {
    const { admin, insert, ownershipEq } = createCleanupAdmin([
      "listings/old-photo.jpg",
      "media/listing/user-1/old-video.mp4",
    ]);

    const queued = await queuePublicMediaCleanup(
      admin,
      [
        "https://media.verifymzansi.com/listings/old-photo.jpg",
        "https://media.verifymzansi.com/listings/old-photo.jpg",
        "https://media.verifymzansi.com/media/listing/user-1/old-video.mp4",
        "https://evil.example.com/not-ours.jpg",
      ],
      "listing_media_replaced",
      "user-1"
    );
    expect(ownershipEq).toHaveBeenCalledWith("user_id", "user-1");

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

  it("never queues media the content owner did not upload", async () => {
    // A post can reference any trusted media URL; deleting or editing it must
    // not delete someone else's upload.
    const { admin, insert } = createCleanupAdmin(["media/listing/attacker/own.jpg"]);

    const queued = await queuePublicMediaCleanup(
      admin,
      [
        "https://media.verifymzansi.com/media/listing/victim/photo.jpg",
        "https://media.verifymzansi.com/media/listing/attacker/own.jpg",
      ],
      "business_deleted",
      "attacker"
    );

    expect(queued.every((key) => key.startsWith("media/listing/attacker/"))).toBe(true);
    const insertedKeys = (insert.mock.calls[0][0] as Array<{ r2_key: string }>).map(
      (row) => row.r2_key
    );
    expect(insertedKeys.some((key) => key.includes("victim"))).toBe(false);
  });

  it("skips the queue entirely when none of the media is owned", async () => {
    const { admin, insert } = createCleanupAdmin([]);

    const queued = await queuePublicMediaCleanup(
      admin,
      ["https://media.verifymzansi.com/media/listing/victim/photo.jpg"],
      "listing_deleted",
      "attacker"
    );

    expect(queued).toEqual([]);
    expect(insert).not.toHaveBeenCalled();
  });
});
