import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import type { FoundationServiceApi } from "./service-api";
import { getR2ObjectSize, putImmutableR2Bytes, type uploadToR2 } from "../services/storage";
import { detectMimeFromMagicBytes } from "../utils/file-validation";
import { scanForMalware } from "../utils/malware-scan";
import {
  ImageReencodeError,
  isReencodableImageType,
  reencodeImage,
  type ReencodableImageType,
} from "../utils/image-reencode";
import { getImageDimensions } from "../utils/image-dimensions";
import { scrubVideoLocationMetadata } from "../utils/isobmff-metadata";
import { scrubWebmMetadata } from "../utils/webm-metadata";
import {
  createPhotoVariants,
  photoVariantsEnabled,
  variantKeysFor,
  variantWidthsFor,
} from "../media/photo-variants";
import { openImagesAllowance, type ImagesAllowance } from "../media/images-allowance";
import { createLogger } from "../utils/logger";
import {
  MAX_VIDEO_SECONDS,
  readVideoBytesSeconds,
  UNREADABLE_VIDEO_LENGTH_MESSAGE,
  videoLengthProblem,
} from "../media/video-length";

const log = createLogger("FoundationMediaUpload");
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

const intent = z.strictObject({
  object_id: z.uuid(),
  object_key: z.string().regex(/^media\/[0-9a-f-]{36}$/),
  max_bytes: z.number().int().positive(),
  state: z.enum(["intent", "ready"]),
  kind: z.enum(["image", "video"]),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  sha256: z.string().nullable(),
  size_bytes: z.number().int().positive().nullable(),
  mime: z.string().nullable(),
});
const finalized = z.strictObject({ object_id: z.uuid(), state: z.enum(["ready", "rejected"]) });
export const foundationUploadedMediaSchema = z.strictObject({
  object_id: z.uuid(),
  url: z.string().url(),
  kind: z.enum(["image", "video"]),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
});
export type FoundationUploadedMedia = z.infer<typeof foundationUploadedMediaSchema>;
/** `images_allowance_exhausted`: photos cannot be re-encoded until the next
 * month (Cloudflare Images error 9422); routes tell the member so.
 * `video_length`: the video is longer than any post allows, or its length
 * cannot be read from the file (roadmap M4.4); `detail` holds the message. */
export type FoundationMediaRefusal = "images_allowance_exhausted" | "video_length";
export class FoundationMediaError extends Error {
  override name = "FoundationMediaError";
  constructor(
    readonly status: 400 | 403 | 409 | 429 | 503,
    readonly reason?: FoundationMediaRefusal,
    readonly detail?: string
  ) {
    super("Media upload could not be completed");
  }
}
/** What a member is told when photo processing has run out for the month. */
export const IMAGES_ALLOWANCE_EXHAUSTED_MESSAGE =
  "Photo uploads are paused for now. Please try again later.";
function refused(error: { code?: string }) {
  throw new FoundationMediaError(
    error.code === "42501"
      ? 403
      : error.code === "PT409"
        ? 409
        : error.code === "PT429"
          ? 429
          : error.code === "22023"
            ? 400
            : 503
  );
}
function arrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

/**
 * Re-encode an uploaded photo (metadata stripping; never skipped). When the
 * monthly Cloudflare Images allowance is used up the upload is refused with a
 * clear reason and an operations alert in the logs; nothing is stored.
 */
async function reencodeUploadedPhoto(
  bytes: Uint8Array,
  mime: ReencodableImageType,
  allowance: ImagesAllowance
) {
  try {
    return await reencodeImage(bytes, mime);
  } catch (error) {
    if (error instanceof ImageReencodeError && error.code === "exhausted") {
      log.error("ALERT Cloudflare Images monthly allowance used up: photo uploads refused", {
        alert: "images_allowance_exhausted",
      });
      await allowance.markUsedUp();
      throw new FoundationMediaError(503, "images_allowance_exhausted");
    }
    throw error;
  }
}

/**
 * Whether any of a photo's copies is missing, so a retried upload does not
 * make them again. When storage cannot say, no copies are made (the media
 * route serves the original).
 */
async function copiesMissing(bucket: string, keys: string[]): Promise<boolean> {
  try {
    const sizes = await Promise.all(keys.map((key) => getR2ObjectSize(bucket, key)));
    return sizes.some((size) => size === null);
  } catch {
    log.warn("Photo display copies not checked; none made");
    return false;
  }
}

/**
 * Stores the WebP display copies of a stored photo beside it
 * (src/lib/media/photo-variants.ts). Best effort: the upload never fails
 * because of a copy, and the media route serves the original when one is
 * missing. Media cleanup deletes the copies with the original
 * (src/lib/foundation/retention-jobs.ts).
 */
async function storePhotoVariants(
  bucket: string,
  objectKey: string,
  bytes: Uint8Array,
  width: number,
  write: typeof uploadToR2 | undefined
): Promise<void> {
  try {
    const variants = await createPhotoVariants(objectKey, bytes, width);
    const stored = await Promise.allSettled(
      variants.map((variant) =>
        write
          ? write({
              bucket,
              key: variant.key,
              file: new Blob([arrayBuffer(variant.bytes)], { type: "image/webp" }),
              contentType: "image/webp",
            })
          : putImmutableR2Bytes(
              bucket,
              variant.key,
              Buffer.from(variant.bytes.buffer, variant.bytes.byteOffset, variant.bytes.byteLength),
              { contentType: "image/webp", cacheControl: IMMUTABLE_CACHE }
            )
      )
    );
    const saved = stored.filter((result) => result.status === "fulfilled").length;
    const wanted = variantWidthsFor(width).length;
    if (saved < wanted) log.warn("Some photo display copies were not stored", { saved, wanted });
  } catch {
    log.warn("Photo display copies were not stored", { saved: 0 });
  }
}

/** Bytes are inspected before reserving storage. The caller-bound reservation
 * authorizes quota/ownership; only the service role may attest the stored bytes.
 * Every uncertain write remains in the DB journal for bounded cleanup. Images
 * transformations made for a photo are counted with one write at the end. */
export async function uploadFoundationMedia(
  api: FoundationAuthenticatedApi,
  service: FoundationServiceApi,
  file: File,
  write: typeof uploadToR2 | undefined = undefined,
  environment = process.env
): Promise<FoundationUploadedMedia> {
  const usage: { allowance?: ImagesAllowance } = {};
  try {
    return await uploadCheckedMedia(api, service, file, write, environment, usage);
  } finally {
    await usage.allowance?.save();
  }
}

async function uploadCheckedMedia(
  api: FoundationAuthenticatedApi,
  service: FoundationServiceApi,
  file: File,
  write: typeof uploadToR2 | undefined,
  environment: NodeJS.ProcessEnv,
  usage: { allowance?: ImagesAllowance }
): Promise<FoundationUploadedMedia> {
  const kind = isReencodableImageType(file.type)
    ? "image"
    : ["video/mp4", "video/webm"].includes(file.type)
      ? "video"
      : null;
  const maximum = kind === "image" ? 5242880 : 52428800;
  if (!kind || !file.size || file.size > maximum) throw new FoundationMediaError(400);
  let bytes = new Uint8Array(await file.arrayBuffer());
  if (
    detectMimeFromMagicBytes(bytes) !== file.type ||
    !scanForMalware(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), file.type).safe
  )
    throw new FoundationMediaError(400);
  if (kind === "video") {
    // Every video on the platform is at most 2 minutes (whole seconds, so the
    // phone's rounding passes). The event limit (1 minute) needs the post's
    // kind, which only the database knows at submit (part B of M4.4).
    const problem = videoLengthProblem(await readVideoBytesSeconds(bytes), MAX_VIDEO_SECONDS);
    if (problem) {
      log.info("Video refused at upload", {
        reason: problem === UNREADABLE_VIDEO_LENGTH_MESSAGE ? "length_unreadable" : "too_long",
      });
      throw new FoundationMediaError(400, "video_length", problem);
    }
  }
  if (isReencodableImageType(file.type)) {
    usage.allowance = await openImagesAllowance();
    bytes = new Uint8Array(await reencodeUploadedPhoto(bytes, file.type, usage.allowance));
    usage.allowance.add(1);
  } else {
    try {
      if (file.type === "video/webm") scrubWebmMetadata(bytes);
      else scrubVideoLocationMetadata(bytes);
    } catch {
      throw new FoundationMediaError(400);
    }
  }
  const dimensions = kind === "image" ? getImageDimensions(bytes) : null;
  if (
    bytes.length > maximum ||
    (kind === "image" && (!dimensions || dimensions.width > 20000 || dimensions.height > 20000))
  )
    throw new FoundationMediaError(400);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const started = await api.rpc("reserve_frontend_media_upload", {
    p_kind: kind,
    p_bytes: bytes.length,
    p_digest: digest,
  });
  if (started.error) refused(started.error);
  const reserved = intent.parse(started.data);
  if (reserved.max_bytes < bytes.length || reserved.kind !== kind)
    throw new FoundationMediaError(503);
  const publicUrl = `${(environment.NEXT_PUBLIC_MEDIA_URL || environment.R2_PUBLIC_URL || "https://media.verifymzansi.com").replace(/\/$/, "")}/${reserved.object_key}`;
  if (reserved.state === "ready") {
    if (
      reserved.sha256 !== digest ||
      reserved.size_bytes !== bytes.length ||
      reserved.mime !== file.type ||
      reserved.width !== (dimensions?.width ?? null) ||
      reserved.height !== (dimensions?.height ?? null)
    )
      throw new FoundationMediaError(409);
    return foundationUploadedMediaSchema.parse({
      object_id: reserved.object_id,
      url: publicUrl,
      kind,
      width: reserved.width,
      height: reserved.height,
    });
  }
  let stored: Awaited<ReturnType<typeof uploadToR2>>;
  try {
    if (write)
      stored = await write({
        bucket: environment.R2_PUBLIC_BUCKET || "verifymzansi-public",
        key: reserved.object_key,
        file: new Blob([arrayBuffer(bytes)], { type: file.type }),
        contentType: file.type,
      });
    else {
      const actual = await putImmutableR2Bytes(
        environment.R2_PUBLIC_BUCKET || "verifymzansi-public",
        reserved.object_key,
        Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        { contentType: file.type, cacheControl: IMMUTABLE_CACHE }
      );
      if (
        actual.length !== bytes.length ||
        createHash("sha256").update(actual).digest("hex") !== digest
      )
        throw new FoundationMediaError(409);
      stored = { key: reserved.object_key, url: publicUrl };
    }
  } catch {
    // A lost transfer reply can follow a stored object. Keep the digest-bound
    // intent so the explicit retry resolves the immutable winner safely.
    throw new FoundationMediaError(503);
  }
  // Before completion, so a photo is never shown before its copies exist.
  // An unfinished upload's copies are deleted with it by media cleanup. Copies
  // stop at the monthly copy budget, leaving the Images allowance for the
  // re-encodes, and a retry whose copies were stored does not make them again.
  const copyKeys = dimensions ? variantKeysFor(reserved.object_key, dimensions.width) : [];
  const bucket = environment.R2_PUBLIC_BUCKET || "verifymzansi-public";
  if (
    dimensions &&
    copyKeys.length &&
    photoVariantsEnabled(environment) &&
    usage.allowance &&
    (await usage.allowance.allowsCopies(copyKeys.length)) &&
    (await copiesMissing(bucket, copyKeys))
  ) {
    usage.allowance.add(copyKeys.length);
    await storePhotoVariants(bucket, reserved.object_key, bytes, dimensions.width, write);
  }
  const completed = await service.rpc("complete_frontend_media_upload", {
    p_object_id: reserved.object_id,
    p_size: bytes.length,
    p_sha256: digest,
    p_mime: file.type,
    ...(dimensions ? { p_width: dimensions.width, p_height: dimensions.height } : {}),
  });
  if (completed.error) refused(completed.error);
  const result = finalized.parse(completed.data);
  if (
    result.object_id !== reserved.object_id ||
    result.state !== "ready" ||
    stored.key !== reserved.object_key
  )
    throw new FoundationMediaError(503);
  return foundationUploadedMediaSchema.parse({
    object_id: result.object_id,
    url: stored.url,
    kind,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
  });
}
