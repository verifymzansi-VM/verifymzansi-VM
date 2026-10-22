/**
 * Server-side re-encoding for every uploaded image.
 *
 * Decoding an image and saving it again keeps only its pixels: EXIF/XMP
 * (including GPS), comments, unknown chunks and any bytes hidden after the
 * image data are dropped, so a polyglot file cannot survive as stored media.
 *
 * Production runs on Cloudflare Workers, where sharp cannot load, so the
 * Cloudflare Images binding (`IMAGES` in wrangler.toml) does the work there.
 * Node (local dev, tests, CI) uses sharp. When neither is available the
 * upload is refused: storing an image that was never re-encoded would
 * silently drop this control.
 */

import { stripExifFromJpeg } from "./exif-strip";
import { detectMimeFromMagicBytes } from "./file-validation";

export const REENCODABLE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ReencodableImageType = (typeof REENCODABLE_IMAGE_TYPES)[number];

export function isReencodableImageType(mime: string): mime is ReencodableImageType {
  return (REENCODABLE_IMAGE_TYPES as readonly string[]).includes(mime);
}

/**
 * `undecodable`: the bytes are not a readable image (tell the uploader).
 * `unavailable`: the re-encoder is down or over quota (try again later).
 */
export type ImageReencodeFailure = "undecodable" | "unavailable";

export class ImageReencodeError extends Error {
  constructor(
    readonly code: ImageReencodeFailure,
    message: string
  ) {
    super(message);
    this.name = "ImageReencodeError";
  }
}

const QUALITY = 90;
/** Cloudflare Images refuses inputs above 100 megapixels; match it locally. */
const MAX_INPUT_PIXELS = 100_000_000;

type ImagesOutput = { response(): Response };
type ImagesBinding = {
  input(stream: ReadableStream<Uint8Array>): {
    output(options: { format: string; quality?: number }): Promise<ImagesOutput>;
  };
};

function isImagesBinding(value: unknown): value is ImagesBinding {
  return !!value && typeof (value as { input?: unknown }).input === "function";
}

async function getImagesBinding(): Promise<ImagesBinding | null> {
  let environment: Record<string, unknown>;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    environment = ctx.env as Record<string, unknown>;
  } catch {
    // Not running inside a Worker (local dev, tests, CI).
    return null;
  }
  if (!isImagesBinding(environment.IMAGES)) {
    throw new ImageReencodeError("unavailable", "Worker image processing binding is missing");
  }
  return environment.IMAGES;
}

/**
 * Images error codes for bad input: 9413 over 100 MP, 9520 unsupported
 * format, 9522/9523 could not be processed. Anything else (9422 monthly quota,
 * 9432 plan, outages) is treated as temporary.
 */
function classifyBindingError(error: unknown): ImageReencodeError {
  const message = error instanceof Error ? error.message : String(error);
  if (/\b9(413|520|522|523)\b/.test(message)) {
    return new ImageReencodeError("undecodable", `Image could not be processed: ${message}`);
  }
  return new ImageReencodeError("unavailable", `Image processing unavailable: ${message}`);
}

async function reencodeWithBinding(
  binding: ImagesBinding,
  bytes: Uint8Array,
  mime: ReencodableImageType
): Promise<Uint8Array> {
  try {
    const copy = new Uint8Array(bytes);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(copy);
        controller.close();
      },
    });
    const output = await binding.input(stream).output({ format: mime, quality: QUALITY });
    return new Uint8Array(await output.response().arrayBuffer());
  } catch (error) {
    throw classifyBindingError(error);
  }
}

async function reencodeWithSharp(bytes: Uint8Array, mime: ReencodableImageType) {
  const sharpModule = await import("sharp").catch(() => null);
  if (!sharpModule) {
    throw new ImageReencodeError("unavailable", "No image re-encoder is available");
  }
  const sharp = sharpModule.default ?? sharpModule;
  try {
    // rotate() applies EXIF orientation before the metadata is dropped; sharp
    // writes no metadata unless asked to.
    const image = sharp(Buffer.from(bytes), {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
    }).rotate();
    const encoded =
      mime === "image/jpeg"
        ? image.jpeg({ quality: QUALITY })
        : mime === "image/png"
          ? image.png()
          : image.webp({ quality: QUALITY });
    return new Uint8Array(await encoded.toBuffer());
  } catch (error) {
    throw new ImageReencodeError(
      "undecodable",
      `Image could not be processed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Decode and re-save an image in the same format. The caller must already
 * have checked that the bytes' magic number matches `mime`.
 */
export async function reencodeImage(
  bytes: Uint8Array,
  mime: ReencodableImageType
): Promise<Uint8Array> {
  const binding = await getImagesBinding();
  let output = binding
    ? await reencodeWithBinding(binding, bytes, mime)
    : await reencodeWithSharp(bytes, mime);

  if (output.length === 0 || detectMimeFromMagicBytes(output) !== mime) {
    throw new ImageReencodeError("unavailable", "Re-encoder returned an unexpected format");
  }
  // Cloudflare Images keeps the EXIF copyright tag on JPEG output by default.
  if (mime === "image/jpeg") output = stripExifFromJpeg(output);
  return output;
}
