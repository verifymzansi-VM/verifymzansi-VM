/** @vitest-environment node */
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createPhotoVariants, photoVariantsEnabled, variantWidthsFor } from "./photo-variants";

const key = "media/0f6c2a8e-1b7d-4e0a-9a51-3c2d9e7b1a01";

/** A photo with detail, so its smaller copies really are smaller. */
async function detailedPhoto(width: number, height: number) {
  const noise = Buffer.alloc(width * height * 3);
  for (let index = 0; index < noise.length; index++) noise[index] = (index * 7919) % 251;
  return new Uint8Array(
    await sharp(noise, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 90 })
      .toBuffer()
  );
}

describe("photo display copies", () => {
  it("are made by default and stop only when MEDIA_PHOTO_VARIANTS is off", () => {
    expect(photoVariantsEnabled({})).toBe(true);
    expect(photoVariantsEnabled({ MEDIA_PHOTO_VARIANTS: "on" })).toBe(true);
    expect(photoVariantsEnabled({ MEDIA_PHOTO_VARIANTS: " OFF " })).toBe(false);
  });

  it("are only made narrower than the original", () => {
    expect(variantWidthsFor(4032)).toEqual([400, 800, 1600]);
    expect(variantWidthsFor(1600)).toEqual([400, 800]);
    expect(variantWidthsFor(1000)).toEqual([400, 800]);
    expect(variantWidthsFor(400)).toEqual([]);
  });

  it("stores 400, 800 and 1600 px WebP copies beside a large photo", async () => {
    const original = await detailedPhoto(2000, 1500);
    const variants = await createPhotoVariants(key, original, 2000);

    expect(variants.map((variant) => variant.key)).toEqual([
      `${key}.w400.webp`,
      `${key}.w800.webp`,
      `${key}.w1600.webp`,
    ]);
    for (const variant of variants) {
      const meta = await sharp(variant.bytes).metadata();
      expect(meta).toMatchObject({ format: "webp", width: variant.width });
      expect(meta.height).toBe(Math.round((variant.width * 1500) / 2000));
      expect(variant.bytes.length).toBeLessThan(original.length);
    }
  });

  it("leaves out a copy that is not smaller than the original", async () => {
    // A flat 800 px photo compresses to almost nothing; a 400 px WebP copy of
    // it is not worth storing when it is not smaller.
    const tiny = new Uint8Array(
      await sharp({ create: { width: 800, height: 600, channels: 3, background: "#123456" } })
        .jpeg({ quality: 20 })
        .toBuffer()
    );
    const variants = await createPhotoVariants(key, tiny, 800);
    for (const variant of variants) expect(variant.bytes.length).toBeLessThan(tiny.length);
  });

  it("never throws: a photo that cannot be read gets no copies", async () => {
    await expect(createPhotoVariants(key, new Uint8Array([1, 2, 3]), 4000)).resolves.toEqual([]);
  });
});
