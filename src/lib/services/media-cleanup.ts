import { createLogger } from "@/lib/utils/logger";
import { extractMediaStorageKey, isTrustedPlatformMediaUrl } from "@/lib/utils/media-url";
import { VARIANT_WIDTHS, variantKeyFor } from "@/lib/services/image-variants";

const log = createLogger("MediaCleanup");

/** Raster image extensions that may have derived responsive variants. */
const VARIANT_SOURCE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "avif", "gif"]);

/**
 * Expand a storage key to include its pre-generated responsive variant keys.
 * Variants (`<stem>.w<W>.webp`) are derived objects that share the original's
 * lifecycle — when the original is deleted, its variants must be deleted too
 * or they leak as orphans in R2. Non-image keys (videos) return unchanged.
 */
function withVariantKeys(key: string): string[] {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  if (!VARIANT_SOURCE_EXTS.has(ext)) return [key];
  // Already a variant key — don't expand further.
  if (/\.w\d+\.webp$/.test(key)) return [key];
  return [key, ...VARIANT_WIDTHS.map((w) => variantKeyFor(key, w))];
}

type InsertableCleanupRow = {
  bucket: string;
  r2_key: string;
  reason: string;
};

type CleanupQueueClient = {
  from: (table: string) => {
    insert: (
      rows: InsertableCleanupRow[]
    ) => PromiseLike<{ error: { message?: string | null } | null }>;
  };
};

export function collectMediaUrls(...values: Array<string | string[] | null | undefined>): string[] {
  return values.flatMap((value) => {
    if (typeof value === "string") {
      return value.trim() ? [value] : [];
    }

    if (Array.isArray(value)) {
      return value.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0
      );
    }

    return [];
  });
}

export function diffRemovedMediaUrls(previousUrls: string[], nextUrls: string[]): string[] {
  const nextSet = new Set(nextUrls);
  return Array.from(new Set(previousUrls.filter((url) => !nextSet.has(url))));
}

export async function queuePublicMediaCleanup(
  admin: CleanupQueueClient,
  urls: string[],
  reason: string
): Promise<string[]> {
  const keys = Array.from(
    new Set(
      urls
        .filter((url) => isTrustedPlatformMediaUrl(url))
        .map((url) => extractMediaStorageKey(url))
        .filter((key): key is string => Boolean(key))
        // Expand to derived responsive variants so they are deleted with the
        // original instead of leaking as orphans in R2.
        .flatMap((key) => withVariantKeys(key))
    )
  );

  if (keys.length === 0) {
    return [];
  }

  const rows = keys.map((key) => ({
    bucket: "public",
    r2_key: key,
    reason,
  }));

  const { error } = await admin.from("r2_cleanup_queue").insert(rows);
  if (error) {
    const message = error.message || "Unknown cleanup queue error";
    log.error("Failed to queue public media cleanup", { error: message, reason, keys });
    throw new Error(message);
  }

  return keys;
}
