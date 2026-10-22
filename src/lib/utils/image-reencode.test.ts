import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cloudflare = vi.hoisted(() => ({ env: {} as Record<string, unknown>, inWorker: false }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => {
    if (!cloudflare.inWorker) throw new Error("not in a Worker");
    return { env: cloudflare.env };
  },
}));

import { isJpegWithExif } from "./exif-strip";
import { detectMimeFromMagicBytes } from "./file-validation";
import { ImageReencodeError, isReencodableImageType, reencodeImage } from "./image-reencode";

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");
const ZIP_PAYLOAD = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from("<script>alert(1)</script>"),
]);

function photo(width = 40, height = 20) {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } });
}

async function jpegWithGpsAndPayload() {
  const jpeg = await photo()
    .jpeg()
    .withExif({ IFD0: { Artist: "SECRET-ARTIST", Copyright: "SECRET-COPYRIGHT" } })
    .toBuffer();
  return new Uint8Array(Buffer.concat([jpeg, ZIP_PAYLOAD]));
}

beforeEach(() => {
  cloudflare.inWorker = false;
  cloudflare.env = {};
});

describe("reencodeImage with sharp (Node)", () => {
  it("drops EXIF and bytes hidden after a JPEG", async () => {
    const input = await jpegWithGpsAndPayload();
    expect(isJpegWithExif(input)).toBe(true);

    const output = await reencodeImage(input, "image/jpeg");

    expect(detectMimeFromMagicBytes(output)).toBe("image/jpeg");
    expect(isJpegWithExif(output)).toBe(false);
    expect(latin1(output)).not.toContain("SECRET-");
    expect(latin1(output)).not.toContain("<script>");
    expect(await sharp(output).metadata()).toMatchObject({ width: 40, height: 20 });
  });

  it("drops text chunks and trailing data from a PNG", async () => {
    const png = await photo().png().withMetadata().toBuffer();
    const textChunk = Buffer.from("tEXtComment\0SECRET-PNG-TEXT");
    const input = new Uint8Array(Buffer.concat([png, textChunk, ZIP_PAYLOAD]));

    const output = await reencodeImage(input, "image/png");

    expect(detectMimeFromMagicBytes(output)).toBe("image/png");
    expect(latin1(output)).not.toContain("SECRET-PNG-TEXT");
    expect(latin1(output)).not.toContain("<script>");
  });

  it("drops EXIF from a WebP", async () => {
    const input = new Uint8Array(
      await photo()
        .webp()
        .withExif({ IFD0: { Artist: "SECRET-WEBP" } })
        .toBuffer()
    );
    expect(latin1(input)).toContain("SECRET-WEBP");

    const output = await reencodeImage(input, "image/webp");

    expect(detectMimeFromMagicBytes(output)).toBe("image/webp");
    expect(latin1(output)).not.toContain("SECRET-WEBP");
  });

  it("applies the EXIF orientation before dropping it", async () => {
    const rotated = await photo(40, 20).jpeg().withMetadata({ orientation: 6 }).toBuffer();

    const output = await reencodeImage(new Uint8Array(rotated), "image/jpeg");

    expect(await sharp(output).metadata()).toMatchObject({ width: 20, height: 40 });
  });

  it("refuses bytes that only look like an image", async () => {
    const fake = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from("not really a jpeg")]);

    await expect(reencodeImage(fake, "image/jpeg")).rejects.toMatchObject({
      name: "ImageReencodeError",
      code: "undecodable",
    });
  });

  it("only accepts JPEG, PNG and WebP", () => {
    expect(["image/jpeg", "image/png", "image/webp"].every(isReencodableImageType)).toBe(true);
    for (const mime of [
      "image/gif",
      "image/avif",
      "image/heic",
      "image/svg+xml",
      "application/pdf",
    ]) {
      expect(isReencodableImageType(mime)).toBe(false);
    }
  });
});

describe("reencodeImage with the Cloudflare Images binding (Workers)", () => {
  it("refuses a Worker with a missing binding rather than falling back to Node", async () => {
    cloudflare.inWorker = true;
    await expect(reencodeImage(await jpegWithGpsAndPayload(), "image/jpeg")).rejects.toMatchObject({
      code: "unavailable",
    });
  });
  function bindingReturning(produce: (input: Uint8Array) => Promise<Uint8Array>) {
    const calls: Array<{ format: string; quality?: number }> = [];
    cloudflare.inWorker = true;
    cloudflare.env.IMAGES = {
      input(stream: ReadableStream<Uint8Array>) {
        return {
          async output(options: { format: string; quality?: number }) {
            calls.push(options);
            const input = new Uint8Array(await new Response(stream).arrayBuffer());
            const bytes = await produce(input);
            return { response: () => new Response(new Uint8Array(bytes)) };
          },
        };
      },
    };
    return calls;
  }

  it("uses the binding in the same format and strips leftover JPEG metadata", async () => {
    // Cloudflare keeps the EXIF copyright tag on JPEG output by default.
    const withCopyright = await photo()
      .jpeg()
      .withExif({ IFD0: { Copyright: "SECRET-COPYRIGHT" } })
      .toBuffer();
    const calls = bindingReturning(async () => new Uint8Array(withCopyright));

    const output = await reencodeImage(await jpegWithGpsAndPayload(), "image/jpeg");

    expect(calls).toEqual([{ format: "image/jpeg", quality: 90 }]);
    expect(isJpegWithExif(output)).toBe(false);
    expect(latin1(output)).not.toContain("SECRET-");
  });

  it.each([
    ["9422: monthly limit reached", "unavailable"],
    ["9432: not available on legacy billing", "unavailable"],
    ["network connection lost", "unavailable"],
    ["ERROR 9520: unsupported image format", "undecodable"],
    ["9523: could not resize", "undecodable"],
  ])("maps binding error %j to %s", async (message, code) => {
    bindingReturning(async () => {
      throw new Error(message);
    });

    const failure = await reencodeImage(await jpegWithGpsAndPayload(), "image/jpeg").catch(
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(ImageReencodeError);
    expect((failure as ImageReencodeError).code).toBe(code);
  });

  it("refuses output that is not the requested format", async () => {
    const png = await photo().png().toBuffer();
    bindingReturning(async () => new Uint8Array(png));

    await expect(reencodeImage(await jpegWithGpsAndPayload(), "image/jpeg")).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});
