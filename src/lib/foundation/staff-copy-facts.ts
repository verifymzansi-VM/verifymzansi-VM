// Not server-only: the staff moderation queue (and its local probes) read it.
import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { SHOW_POST_COPY } from "../hidden-features";
import { createLogger } from "../utils/logger";

const log = createLogger("StaffCopyFacts");

const staffCopyFacts = z.strictObject({
  items: z
    .array(
      z.strictObject({
        post_id: z.uuid(),
        copied_from: z
          .strictObject({ id: z.uuid(), title: z.string().nullable(), status: z.string() })
          .nullable(),
        same_photos: z
          .array(
            z.strictObject({
              id: z.uuid(),
              title: z.string().nullable(),
              photos: z.number().int().positive(),
            })
          )
          .max(10),
      })
    )
    .max(25),
});
export type StaffCopyFacts = Omit<z.infer<typeof staffCopyFacts>["items"][number], "post_id">;

/**
 * For posts the reviewer has claimed: the post each was copied from and the
 * seller's live posts with a byte-identical photo
 * (api.get_frontend_staff_copy_facts). A hint for the reviewer only, so a
 * failed read leaves it out instead of failing the queue.
 */
export async function readStaffCopyFacts(
  api: FoundationAuthenticatedApi,
  postIds: string[]
): Promise<Map<string, StaffCopyFacts>> {
  const facts = new Map<string, StaffCopyFacts>();
  if (!SHOW_POST_COPY || postIds.length === 0) return facts;
  try {
    const result = await api.rpc(
      "get_frontend_staff_copy_facts",
      { p_posts: postIds.slice(0, 25) },
      { get: false }
    );
    if (result.error) throw new Error(result.error.code ?? "read failed");
    for (const { post_id, ...item } of staffCopyFacts.parse(result.data).items)
      if (postIds.includes(post_id)) facts.set(post_id, item);
  } catch (error) {
    log.warn("Copy facts unavailable", {
      error: error instanceof Error ? error.message : "unknown",
    });
  }
  return facts;
}
