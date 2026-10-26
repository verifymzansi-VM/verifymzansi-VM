import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import type { FoundationServiceApi } from "./service-api";
import { uploadToR2 } from "../services/storage";
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
  write = uploadToR2,
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
    !scanForMalware(Buffer.from(bytes), file.type).safe
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
  const started = await api.rpc("begin_media_upload", { p_kind: kind, p_bytes: bytes.length });
  if (started.error) refused(started.error);
  const reserved = intent.parse(started.data);
  if (reserved.max_bytes < bytes.length) throw new FoundationMediaError(503);
  let stored: Awaited<ReturnType<typeof uploadToR2>>;
  try {
    stored = await write({
      bucket: environment.R2_PUBLIC_BUCKET || "verifymzansi-public",
      key: reserved.object_key,
      file: new Blob([arrayBuffer(bytes)], { type: file.type }),
      contentType: file.type,
    });
  } catch {
    // A failed/ambiguous transfer must never become a ready object. Do not
    // discard the reservation: its rejection/intent can be swept safely later.
    await Promise.resolve(
      service.rpc("finalize_media", {
        p_object_id: reserved.object_id,
        p_size: 0,
        p_sha256: createHash("sha256").update(bytes).digest("hex"),
        p_mime: file.type,
      })
    ).catch(() => {});
    throw new FoundationMediaError(503);
  }
  const completed = await service.rpc("finalize_media", {
    p_object_id: reserved.object_id,
    p_size: bytes.length,
    p_sha256: createHash("sha256").update(bytes).digest("hex"),
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
