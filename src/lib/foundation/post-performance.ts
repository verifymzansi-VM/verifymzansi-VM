import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import type { FoundationServiceApi } from "./service-api";

/**
 * Post performance statistics (database update
 * 20261121100028_post_performance_stats.sql).
 *
 * - recordFoundationPostActivity: the website server's service command for
 *   the events pages already send to /api/analytics/events (appearances,
 *   detail views with where the visitor came from, contact taps, shares) and
 *   engaged video views from /api/engagement/view. The database keeps only
 *   daily counts per post; never an account, browser identifier, address or
 *   user agent.
 * - readFoundationPostPerformance: the owner's own Performance page read.
 */

/** The daily counters of a post, by name (the table's columns), plus the
 * engaged view, which needs the signed browser identifier. */
export const ACTIVITY_COUNTERS = [
  "list_impressions",
  "search_appearances",
  "homepage_appearances",
  "showroom_home",
  "showroom_business",
  "showroom_market",
  "showroom_tourism",
  "showroom_programme",
  "directory_appearances",
  "views_direct",
  "views_internal",
  "views_search",
  "views_social",
  "views_referral",
  "whatsapp_taps",
  "phone_taps",
  "website_taps",
  "directions_taps",
  "booking_taps",
  "ticket_taps",
  "shares",
  "engaged_views",
] as const;
export type ActivityCounter = (typeof ACTIVITY_COUNTERS)[number];

/** Events one command may carry (the database limit). */
export const MAX_ACTIVITY_EVENTS = 50;

const SHOWROOMS: Record<string, ActivityCounter> = {
  "showroom:home": "showroom_home",
  "showroom:business": "showroom_business",
  "showroom:market": "showroom_market",
  "showroom:tourism": "showroom_tourism",
};
const DETAIL_VIEW_SOURCES: Record<string, ActivityCounter> = {
  internal: "views_internal",
  search: "views_search",
  social: "views_social",
  referral: "views_referral",
};
const DIRECT: Record<string, ActivityCounter> = {
  impression: "list_impressions",
  search_appearance: "search_appearances",
  homepage_appearance: "homepage_appearances",
  organisation_directory_appearance: "directory_appearances",
  whatsapp_click: "whatsapp_taps",
  phone_click: "phone_taps",
  website_click: "website_taps",
  directions_click: "directions_taps",
  booking_click: "booking_taps",
  ticket_click: "ticket_taps",
  share: "shares",
};

/**
 * The counter of an event the pages send (src/lib/analytics/commercial-events.ts),
 * or null for an event this backend does not count here: a save (the Saves
 * figure is the post's likes), a sponsor click and anything about an
 * organisation rather than a post.
 */
export function activityCounter(event: {
  type: string;
  surface?: string;
  source?: string;
}): ActivityCounter | null {
  if (event.type === "showroom_appearance")
    return SHOWROOMS[event.surface ?? ""] ?? "showroom_programme";
  if (event.type === "detail_view")
    return DETAIL_VIEW_SOURCES[event.source ?? ""] ?? "views_direct";
  return DIRECT[event.type] ?? null;
}

export class FoundationActivityError extends Error {
  override name = "FoundationActivityError";
  constructor() {
    super("Post activity refused: invalid");
  }
}

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const activityResult = z.strictObject({ posts: count, engaged: count });

/** Adds 1 to 50 events to the posts' daily counters. `device` (the signed
 * browser identifier) is required for engaged views. */
export async function recordFoundationPostActivity(
  api: FoundationServiceApi,
  input: {
    events: ReadonlyArray<{ postId: string; counter: ActivityCounter }>;
    device: string | null;
    account: string | null;
  }
): Promise<z.infer<typeof activityResult>> {
  const events = z
    .array(z.strictObject({ postId: z.uuid(), counter: z.enum(ACTIVITY_COUNTERS) }))
    .min(1)
    .max(MAX_ACTIVITY_EVENTS)
    .parse(input.events);
  const { data, error } = await api.rpc("record_post_activity", {
    p_post_ids: events.map((event) => event.postId),
    p_metrics: events.map((event) => event.counter),
    ...(input.device ? { p_device: z.uuid().parse(input.device) } : {}),
    ...(input.account ? { p_account: z.uuid().parse(input.account) } : {}),
  });
  if (error?.code === "22023") throw new FoundationActivityError();
  if (error) throw new Error("Post activity command failed");
  return activityResult.parse(data);
}

const title = z.string().max(120).nullable();
const area = z.enum(["market", "business", "tourism_events"]);
const performanceSchema = z.strictObject({
  posts: count,
  live_posts: count,
  views: count,
  engaged_views: count,
  leads: count,
  last_30_days: z.strictObject({
    impression: count,
    detail_view: count,
    whatsapp_click: count,
    phone_click: count,
    website_click: count,
    directions_click: count,
    booking_click: count,
    ticket_click: count,
    showroom_appearance: count,
    organisation_directory_appearance: count,
    search_appearance: count,
    homepage_appearance: count,
    share: count,
    save: count,
    unique_viewers: count,
  }),
  top_posts: z
    .array(
      z.strictObject({
        post_id: z.uuid(),
        title,
        area,
        appearances: count,
        views: count,
        unique_viewers: count,
        contacts: count,
        saves: count,
        shares: count,
      })
    )
    .max(10),
  sources: z
    .array(
      z.strictObject({
        source: z.enum(["direct", "internal", "search", "social", "referral"]),
        views: count,
      })
    )
    .max(5),
  showroom_turns: z.array(
    z.strictObject({
      post_id: z.uuid(),
      title,
      surface: z.enum(["home", "business", "market", "tourism"]),
      appearances: count,
      fair_share: z.number().min(0),
      eligible_posts: count,
    })
  ),
});
export type PostPerformance = z.infer<typeof performanceSchema>;

/** The signed-in owner's Performance page figures (own posts only). */
export async function readFoundationPostPerformance(
  api: FoundationAuthenticatedApi
): Promise<PostPerformance> {
  const { data, error } = await api.rpc("get_my_post_performance", {}, { get: false });
  if (error) throw new Error("Post performance could not be loaded");
  return performanceSchema.parse(data);
}
