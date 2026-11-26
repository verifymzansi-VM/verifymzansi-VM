// Not server-only: the staff moderation queue (and its local probes) read it.
import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { createLogger } from "../utils/logger";

const log = createLogger("StaffVideoLengths");

const staffVideoLengths = z
  .array(
    z.strictObject({
      post_id: z.uuid(),
      object_key: z.string().regex(/^media\/[0-9a-f-]{36}$/),
      duration_ms: z.number().int().min(1).max(120999).nullable(),
    })
  )
  .max(500);

/** A video's stored length in whole seconds (null when not recorded). */
export type StaffVideoLength = { seconds: number | null };

/**
 * For the posts the reviewer has claimed: each video's stored length, in the
 * post's media order (api.get_frontend_staff_video_lengths). A hint for the
 * reviewer only (the database already refused over-length videos at submit),
 * so a failed read leaves it out instead of failing the queue.
 */
export async function readStaffVideoLengths(
  api: FoundationAuthenticatedApi,
  postIds: string[]
): Promise<Map<string, StaffVideoLength[]>> {
  const lengths = new Map<string, StaffVideoLength[]>();
  if (postIds.length === 0) return lengths;
  try {
    const result = await api.rpc(
      "get_frontend_staff_video_lengths",
      { p_posts: postIds.slice(0, 50) },
      { get: false }
    );
    if (result.error) throw new Error(result.error.code ?? "read failed");
    for (const row of staffVideoLengths.parse(result.data)) {
      if (!postIds.includes(row.post_id)) continue;
      const seconds = row.duration_ms === null ? null : Math.floor(row.duration_ms / 1000);
      lengths.set(row.post_id, [...(lengths.get(row.post_id) ?? []), { seconds }]);
    }
  } catch (error) {
    log.warn("Video lengths unavailable", {
      error: error instanceof Error ? error.message : "unknown",
    });
  }
  return lengths;
}
