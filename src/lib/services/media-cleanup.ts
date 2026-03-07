import { createLogger } from "@/lib/utils/logger";
import { extractMediaStorageKey, isTrustedPlatformMediaUrl } from "@/lib/utils/media-url";

const log = createLogger("MediaCleanup");

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
