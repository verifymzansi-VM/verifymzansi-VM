import { z } from "zod";
import type { FoundationPublicApi } from "./public-api";
import type { FoundationServiceApi } from "./service-api";

/**
 * Post view counts and likes (database update
 * 20261119172135_post_views_and_likes.sql).
 *
 * - readFoundationPostEngagement: public totals of publicly listed posts
 *   (api.get_post_engagement); never who viewed or liked.
 * - recordFoundationPostViews / setFoundationPostLike: the website server's
 *   service commands, with the browser identifier from the first-party
 *   `vmz_viewer` cookie and the GoTrue-verified account or none. The database
 *   stores only keyed hashes of the identifier.
 */

export type PostEngagement = { views: number; likes: number };

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const ids = z.array(z.uuid()).max(500);
const engagementResult = z.strictObject({
  items: z.array(z.strictObject({ post_id: z.uuid(), views: count, likes: count })).max(50),
});

/** Totals of the given posts, by id; posts that are not publicly listed are
 * absent. Reads in batches of 50 (the database limit). */
export async function readFoundationPostEngagement(
  api: FoundationPublicApi,
  postIds: readonly string[]
): Promise<Map<string, PostEngagement>> {
  const unique = [...new Set(ids.parse(postIds))];
  const totals = new Map<string, PostEngagement>();
  const batches: string[][] = [];
  while (unique.length > batches.length * 50)
    batches.push(unique.slice(batches.length * 50, batches.length * 50 + 50));
  for (const batch of batches) {
    const { data, error } = await api.rpc(
      "get_post_engagement",
      { p_post_ids: batch },
      { get: false }
    );
    if (error) throw new Error("Post engagement could not be loaded");
    const allowed = new Set(batch);
    for (const item of engagementResult.parse(data).items) {
      if (!allowed.has(item.post_id) || totals.has(item.post_id))
        throw new Error("Invalid post engagement response");
      totals.set(item.post_id, { views: item.views, likes: item.likes });
    }
  }
  return totals;
}

export class FoundationEngagementError extends Error {
  override name = "FoundationEngagementError";
  constructor(readonly reason: "unavailable" | "invalid") {
    super(`Post engagement refused: ${reason}`);
  }
}

function refusal(error: { code?: string } | null): never {
  if (error?.code === "PT404") throw new FoundationEngagementError("unavailable");
  if (error?.code === "22023") throw new FoundationEngagementError("invalid");
  throw new Error("Post engagement command failed");
}

const viewsResult = z.strictObject({ counted: z.array(z.uuid()).max(5) });

/** Records one view of each post (1 to 5); returns the posts counted as new
 * views. */
export async function recordFoundationPostViews(
  api: FoundationServiceApi,
  input: { postIds: readonly string[]; device: string; account: string | null }
): Promise<string[]> {
  const postIds = z
    .array(z.uuid())
    .min(1)
    .max(5)
    .parse([...new Set(input.postIds)]);
  const { data, error } = await api.rpc("record_post_views", {
    p_post_ids: postIds,
    p_device: z.uuid().parse(input.device),
    ...(input.account ? { p_account: z.uuid().parse(input.account) } : {}),
  });
  if (error) refusal(error);
  const counted = viewsResult.parse(data).counted;
  const asked = new Set(postIds);
  if (counted.some((id) => !asked.has(id))) throw new Error("Invalid post view response");
  return counted;
}

const likeResult = z.strictObject({ liked: z.boolean(), likes: count, counted: z.boolean() });

/** Sets the signed-in account's like, or the browser's when signed out, on a
 * post to `liked`, or toggles it when `liked` is null. `deviceIssuedAt`: when
 * the browser identifier was issued (a signed-out like from a new identifier
 * counts from 10 minutes after it). */
export async function setFoundationPostLike(
  api: FoundationServiceApi,
  input: {
    postId: string;
    device: string;
    account: string | null;
    liked: boolean | null;
    deviceIssuedAt?: Date | null;
  }
): Promise<z.infer<typeof likeResult>> {
  const { data, error } = await api.rpc("set_post_like", {
    p_post_id: z.uuid().parse(input.postId),
    p_device: z.uuid().parse(input.device),
    ...(input.account ? { p_account: z.uuid().parse(input.account) } : {}),
    ...(input.liked === null ? {} : { p_liked: input.liked }),
    ...(input.deviceIssuedAt ? { p_device_issued_at: input.deviceIssuedAt.toISOString() } : {}),
  });
  if (error) refusal(error);
  return likeResult.parse(data);
}
