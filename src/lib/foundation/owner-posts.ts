import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";

const post = z.strictObject({
  id: z.uuid(),
  kind: z.enum(["listing", "business", "event"]),
  area: z.enum(["market", "business", "tourism_events"]),
  category: z.string(),
  title: z.string().nullable(),
  status: z.enum([
    "draft",
    "pending_moderation",
    "live",
    "paused",
    "rejected",
    "expired",
    "sold",
    "archived",
  ]),
  revision: z.number().int().positive(),
  created_at: z.string(),
  published_at: z.string().nullable(),
  visible_until: z.string().nullable(),
  price_mode: z.enum(["amount", "free", "on_request"]).nullable(),
  price_cents: z.string().regex(/^\d+$/).nullable(),
  cover_object_key: z
    .string()
    .regex(/^media\/[a-f0-9-]{36}$/)
    .nullable(),
});
const page = z.strictObject({
  items: z.array(post).max(100),
  total: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(100),
  offset: z.number().int().nonnegative(),
});
export type FoundationOwnerPost = z.infer<typeof post>;
export async function listFoundationOwnerPosts(
  api: FoundationAuthenticatedApi,
  limit = 48,
  offset = 0
) {
  const { data, error } = await api.rpc("list_my_posts", { p_limit: limit, p_offset: offset });
  if (error) throw new Error("Your posts could not be loaded");
  return page.parse(data);
}
export function foundationPostPath(post: Pick<FoundationOwnerPost, "id" | "kind" | "area">) {
  return `${post.kind === "listing" ? "/listing" : post.area === "business" ? "/mzansi-business" : "/tourism-events"}/${post.id}`;
}
export function foundationPostEditPath(post: Pick<FoundationOwnerPost, "id" | "kind" | "area">) {
  return `${post.kind === "listing" ? "/post/edit-listing" : post.area === "business" ? "/post/edit-business" : "/post/edit-tourism"}/${post.id}`;
}
