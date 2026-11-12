import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import type { FoundationServiceApi } from "./service-api";
import { putImmutableR2Bytes, type uploadToR2 } from "../services/storage";
import { detectMimeFromMagicBytes } from "../utils/file-validation";
import { scanForMalware } from "../utils/malware-scan";
import { isReencodableImageType, reencodeImage } from "../utils/image-reencode";
import { getImageDimensions } from "../utils/image-dimensions";
import { scrubVideoLocationMetadata } from "../utils/isobmff-metadata";
import { scrubWebmMetadata } from "../utils/webm-metadata";

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
export class FoundationMediaError extends Error {
  override name = "FoundationMediaError";
  constructor(readonly status: 400 | 403 | 409 | 429 | 503) {
    super("Media upload could not be completed");
  }
}
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

/** Bytes are inspected before reserving storage. The caller-bound reservation
 * authorizes quota/ownership; only the service role may attest the stored bytes.
 * Every uncertain write remains in the DB journal for bounded cleanup. */
export async function uploadFoundationMedia(
  api: FoundationAuthenticatedApi,
  service: FoundationServiceApi,
  file: File,
  write: typeof uploadToR2 | undefined = undefined,
  environment = process.env
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
  if (isReencodableImageType(file.type))
    bytes = new Uint8Array(await reencodeImage(bytes, file.type));
  else {
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
        { contentType: file.type, cacheControl: "public, max-age=31536000, immutable" }
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
