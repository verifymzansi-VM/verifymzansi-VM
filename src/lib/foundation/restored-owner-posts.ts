import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import {
  frontendPostPresentationSchema,
  presentedFormFields,
  presentedVideoLayout,
} from "./post-presentation";
import { foundationMediaUrl } from "./public-media-url";
import reference from "../domains/taxonomy/reference.json";
import { OWNER_DEACTIVATED_REASON } from "../posting/content-status";
const instant = z.iso.datetime({ offset: true });
function presentedStatusReason(reason: string | null) {
  if (reason === "staff_hidden") return "Hidden for staff review";
  if (reason === "staff_review_cleared") return "Staff review cleared; resubmit for approval";
  return reason;
}
const status = z.enum([
  "draft",
  "pending_moderation",
  "live",
  "paused",
  "rejected",
  "expired",
  "sold",
  "archived",
]);
const listing = z.strictObject({
  price_mode: z.enum(["amount", "free", "on_request"]).nullable(),
  price_cents: z.number().int().nonnegative().max(100000000000).nullable(),
  price_negotiable: z.boolean(),
  attributes: z.record(z.string(), z.unknown()),
  attributes_version: z.literal(1),
});
const ownedFields = {
  id: z.uuid(),
  kind: z.enum(["listing", "business", "event"]),
  area: z.enum(["market", "business", "tourism_events"]),
  category: z.string(),
  activity: z.string().nullable(),
  status,
  status_reason: z.string().nullable(),
  revision: z.number().int().positive(),
  edit_of: z.uuid().nullable(),
  created_at: instant,
  updated_at: instant,
  published_at: instant.nullable(),
  expires_at: instant.nullable(),
  content: z.strictObject({
    title: z.string().nullable(),
    description: z.string().nullable(),
    province_id: z.string().nullable(),
    city_id: z.string().nullable(),
    locality_label: z.string().nullable(),
  }),
  listing: listing.nullable(),
  business_type: z.string().nullable(),
  event_window: z
    .strictObject({ starts_at: instant, ends_at: instant, timezone: z.string() })
    .nullable(),
  contact_channels: z.array(z.enum(["call", "whatsapp", "form"])).nullable(),
  media: z
    .array(
      z.strictObject({
        object_id: z.uuid(),
        object_key: z.string().regex(/^media\/[a-f0-9-]{36}$/),
        kind: z.enum(["image", "video"]),
        state: z.enum(["intent", "ready", "rejected", "cleanup_required", "deleted"]),
        purpose: z.enum(["cover", "gallery", "logo", "video"]),
        position: z.number().int().nonnegative(),
        width: z.number().int().positive().nullable(),
        height: z.number().int().positive().nullable(),
        focal_x: z.number().min(0).max(1).nullable(),
        focal_y: z.number().min(0).max(1).nullable(),
      })
    )
    .max(100),
  frontend: frontendPostPresentationSchema,
  contacts: z.strictObject({
    phone: z.string().nullable().optional(),
    whatsapp: z.string().nullable().optional(),
  }),
  pending_edit: z
    .strictObject({ id: z.uuid(), status, revision: z.number().int().positive() })
    .nullable(),
};
const consistentDetail = (v: { kind: string; listing: unknown; event_window: unknown }) =>
  (v.kind === "listing") === (v.listing !== null) &&
  (v.kind === "event") === (v.event_window !== null);
// The staff review reads the original owner form; the owner's own reads
// (get_my_frontend_post_v2, list_my_frontend_posts_v2) add when the
// lifecycle job will delete the post, or null.
const owned = z.strictObject(ownedFields).refine(consistentDetail);
const ownedWithDeletion = z
  .strictObject({ ...ownedFields, deletes_at: instant.nullable() })
  .refine(consistentDetail);
export function parseRestoredOwnerPost(input: unknown) {
  return input === null ? null : owned.parse(input);
}
export type RestoredOwnerPost = z.infer<typeof owned> & { deletes_at?: string | null };
export function restoredOwnerPostRow(post: RestoredOwnerPost, owner: string) {
  const images = post.media
    .filter((m) => m.kind === "image" && m.purpose !== "logo" && m.state === "ready")
    .sort((a, b) =>
      a.purpose === "cover" ? -1 : b.purpose === "cover" ? 1 : a.position - b.position
    );
  const videos = post.media
    .filter((m) => m.kind === "video" && m.state === "ready")
    .sort((a, b) => a.position - b.position);
  const attrs: Record<string, unknown> = { ...post.listing?.attributes };
  for (const field of reference.listingFields.filter(
    (f) => f.category === post.category && f.key !== f.sourceKey
  )) {
    const value = attrs[field.key];
    if (value !== undefined) {
      attrs[field.sourceKey] =
        field.unit === "ZAR_cents" && typeof value === "number" ? value / 100 : value;
      delete attrs[field.key];
    }
  }
  const extras = presentedFormFields(post.frontend, post.kind === "business");
  const city =
    reference.cities.find((c) => c.id === post.content.city_id)?.label ??
    post.content.locality_label ??
    "";
  const province = reference.provinces.find((p) => p.id === post.content.province_id)?.label ?? "";
  const photos = images.map((m) => foundationMediaUrl(m.object_key)!);
  const videoLayout = videos.length ? presentedVideoLayout(post.frontend) : null;
  const categoryDetails = post.frontend.data.category_details;
  const businessChannels =
    categoryDetails && typeof categoryDetails === "object" && !Array.isArray(categoryDetails)
      ? ((categoryDetails as Record<string, unknown>).contact_methods ?? [])
      : [];
  return {
    id: post.id,
    owner_id: owner,
    user_id: owner,
    seller_id: owner,
    kind: post.kind,
    area:
      post.area === "market"
        ? "MZANSI_MARKET"
        : post.area === "business"
          ? "MZANSI_BUSINESS"
          : "PROMOTIONS_EVENTS",
    title: post.content.title ?? "",
    business_name: post.content.title ?? "",
    description: post.content.description ?? "",
    category: post.category,
    category_key: post.kind === "event" ? null : post.category,
    subcategory: post.activity,
    business_type: post.business_type,
    promotion_type: "event",
    status: post.status === "paused" ? "hidden" : post.status,
    status_reason:
      post.status === "paused" && !post.status_reason?.startsWith("staff_")
        ? OWNER_DEACTIVATED_REASON
        : presentedStatusReason(post.status_reason),
    moderation_notes: presentedStatusReason(post.status_reason),
    rejection_reason: presentedStatusReason(post.status_reason),
    revision: post.revision,
    edit_of: post.edit_of,
    pending_edit: post.pending_edit,
    created_at: post.created_at,
    updated_at: post.updated_at,
    published_at: post.published_at,
    expires_at: post.expires_at,
    deletes_at: post.deletes_at ?? null,
    price_mode: post.listing?.price_mode ?? null,
    price_cents:
      post.kind === "event" && typeof post.frontend.data.ticket_price_cents === "number"
        ? post.frontend.data.ticket_price_cents
        : (post.listing?.price_cents ?? null),
    price_negotiable: post.listing?.price_negotiable ?? false,
    condition: attrs.condition ?? null,
    location_province:
      post.business_type === "online_only"
        ? (post.frontend.data.location_province ?? province)
        : province,
    location_city:
      post.business_type === "online_only" ? (post.frontend.data.location_city ?? city) : city,
    location_town: null,
    location_address: null,
    photos,
    videos: videos.map((m) => foundationMediaUrl(m.object_key)!),
    gallery_photos: photos,
    cover_photo: photos[0] ?? null,
    cover_video: videos[0] ? foundationMediaUrl(videos[0].object_key) : null,
    logo_url: foundationMediaUrl(
      post.media.find((m) => m.purpose === "logo" && m.state === "ready")?.object_key
    ),
    video_thumbnail: photos[0] ?? null,
    media_width: videoLayout?.width ?? images[0]?.width ?? videos[0]?.width ?? null,
    media_height: videoLayout?.height ?? images[0]?.height ?? videos[0]?.height ?? null,
    focal_x: videos[0]?.focal_x ?? images[0]?.focal_x ?? 0.5,
    focal_y: videos[0]?.focal_y ?? images[0]?.focal_y ?? 0.5,
    contact_methods: post.contact_channels ?? businessChannels,
    phone: post.contacts.phone ?? null,
    whatsapp: post.contacts.whatsapp ?? null,
    email: null,
    website: null,
    start_date: post.event_window?.starts_at ?? null,
    end_date: post.event_window?.ends_at ?? null,
    view_count: null,
    like_count: null,
    attributes: { ...((extras.attributes as Record<string, unknown>) ?? {}), ...attrs },
    ...Object.fromEntries(Object.entries(extras).filter(([k]) => k !== "attributes")),
  };
}
// The owner's reads with the deletion date come with database update
// 20261109104020_post_expiry_rules.sql. Against a database without it, the
// original reads answer and the deletion date is null.
function missingRead(error: { code?: string } | null) {
  return error?.code === "PGRST202" || error?.code === "42883";
}
export async function readRestoredOwnerPost(api: FoundationAuthenticatedApi, id: string) {
  const normalized = z.uuid().parse(id).toLowerCase();
  let parsed: RestoredOwnerPost | null;
  const result = await api.rpc("get_my_frontend_post_v2", { p_id: normalized }, { get: false });
  if (missingRead(result.error)) {
    const earlier = await api.rpc("get_my_frontend_post", { p_id: normalized }, { get: false });
    if (earlier.error) throw new Error("Your post could not be loaded");
    parsed = parseRestoredOwnerPost(earlier.data);
  } else {
    if (result.error) throw new Error("Your post could not be loaded");
    parsed = result.data === null ? null : ownedWithDeletion.parse(result.data);
  }
  if (parsed && parsed.id !== normalized) throw new Error("Post changed");
  return parsed;
}
export async function listRestoredOwnerPosts(
  api: FoundationAuthenticatedApi,
  kind: "listing" | "business" | "event",
  area?: string
) {
  const items: RestoredOwnerPost[] = [];
  let withDeletion = true;
  for (let offset = 0; offset <= 10000; offset += 100) {
    const args = {
      p_kind: kind,
      ...(area ? { p_area: area } : {}),
      p_limit: 100,
      p_offset: offset,
    };
    let result = withDeletion
      ? await api.rpc("list_my_frontend_posts_v2", args, { get: false })
      : await api.rpc("list_my_frontend_posts", args, { get: false });
    if (withDeletion && missingRead(result.error)) {
      withDeletion = false;
      result = await api.rpc("list_my_frontend_posts", args, { get: false });
    }
    if (result.error) throw new Error("Your posts could not be loaded");
    const item: z.ZodType<RestoredOwnerPost> = withDeletion ? ownedWithDeletion : owned;
    const page = z
      .strictObject({
        items: z.array(item).max(100),
        total: z.number().int().nonnegative(),
        limit: z.literal(100),
        offset: z.number().int().nonnegative(),
      })
      .parse(result.data);
    if (
      page.offset !== offset ||
      page.items.some((p) => p.kind !== kind || p.edit_of !== null || (area && p.area !== area))
    )
      throw new Error("Owner collection changed");
    items.push(...page.items);
    if (items.length >= page.total || page.items.length < 100) {
      if (new Set(items.map((p) => p.id)).size !== items.length)
        throw new Error("Owner collection changed");
      return items;
    }
  }
  throw new Error("Your post collection is too large to load safely");
}
