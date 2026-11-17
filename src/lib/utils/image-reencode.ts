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
 * `exhausted`: the monthly Cloudflare Images allowance is used up (error 9422;
 * new transformations fail until the next calendar month).
 * `unavailable`: the re-encoder is down or failed otherwise (try again later).
 */
export type ImageReencodeFailure = "undecodable" | "exhausted" | "unavailable";

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

/** Quality of the smaller WebP display copies (see resizeImageToWebp). */
const VARIANT_QUALITY = 80;

type ImagesOutput = { response(): Response };
type ImagesTransformer = {
  transform(options: { width: number; fit: "scale-down" }): ImagesTransformer;
  output(options: { format: string; quality?: number }): Promise<ImagesOutput>;
};
type ImagesBinding = {
  input(stream: ReadableStream<Uint8Array>): ImagesTransformer;
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
 * format, 9522/9523 could not be processed. 9422: the monthly allowance is
 * used up (https://developers.cloudflare.com/images/reference/troubleshooting/).
 * Anything else (9432 plan, outages) is treated as temporary.
 */
function classifyBindingError(error: unknown): ImageReencodeError {
  const message = error instanceof Error ? error.message : String(error);
  if (/\b9(413|520|522|523)\b/.test(message)) {
    return new ImageReencodeError("undecodable", `Image could not be processed: ${message}`);
  }
  if (/\b9422\b/.test(message)) {
    return new ImageReencodeError("exhausted", `Images allowance used up: ${message}`);
  }
  return new ImageReencodeError("unavailable", `Image processing unavailable: ${message}`);
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  const copy = new Uint8Array(bytes);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(copy);
      controller.close();
    },
  });
}

async function reencodeWithBinding(
  binding: ImagesBinding,
  bytes: Uint8Array,
  mime: ReencodableImageType
): Promise<Uint8Array> {
  try {
    const output = await binding.input(streamOf(bytes)).output({ format: mime, quality: QUALITY });
    return new Uint8Array(await output.response().arrayBuffer());
  } catch (error) {
    throw classifyBindingError(error);
  }
}

async function resizeWithBinding(
  binding: ImagesBinding,
  bytes: Uint8Array,
  width: number
): Promise<Uint8Array> {
  try {
    const output = await binding
      .input(streamOf(bytes))
      .transform({ width, fit: "scale-down" })
      .output({ format: "image/webp", quality: VARIANT_QUALITY });
    return new Uint8Array(await output.response().arrayBuffer());
  } catch (error) {
    throw classifyBindingError(error);
  }
}

async function resizeWithSharp(bytes: Uint8Array, width: number): Promise<Uint8Array> {
  const sharpModule = await import("sharp").catch(() => null);
  if (!sharpModule) {
    throw new ImageReencodeError("unavailable", "No image re-encoder is available");
  }
  const sharp = sharpModule.default ?? sharpModule;
  try {
    const resized = sharp(Buffer.from(bytes), {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: VARIANT_QUALITY });
    return new Uint8Array(await resized.toBuffer());
  } catch (error) {
    throw new ImageReencodeError(
      "undecodable",
      `Image could not be processed: ${error instanceof Error ? error.message : String(error)}`
    );
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

/**
 * A smaller WebP copy of an image that `reencodeImage` already re-saved:
 * `width` pixels wide, height in proportion, never enlarged. Used for the
 * display copies (src/lib/media/photo-variants.ts). Each call
 * on Workers is one Cloudflare Images transformation.
 */
export async function resizeImageToWebp(bytes: Uint8Array, width: number): Promise<Uint8Array> {
  const binding = await getImagesBinding();
  const output = binding
    ? await resizeWithBinding(binding, bytes, width)
    : await resizeWithSharp(bytes, width);
  if (output.length === 0 || detectMimeFromMagicBytes(output) !== "image/webp") {
    throw new ImageReencodeError("unavailable", "Resizer returned an unexpected format");
  }
  return output;
}
