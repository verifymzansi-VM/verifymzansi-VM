import "server-only";
import { cache } from "react";
import { readFoundationServerSession } from "./server-session";
import {
  readFoundationOwnerDashboard,
  presentedDashboardProfile,
  dashboardVerificationSteps,
  dashboardPosts,
} from "./owner-dashboard";
import { readRestoredOwnerPost } from "./restored-owner-posts";
import type { FoundationAuthenticatedApi } from "./authenticated-api";

export const readRestoredOwnerDashboard = cache(async (accountId: string) => {
  const current = await readFoundationServerSession();
  if (current.user.id !== accountId) throw new Error("Dashboard account changed");
  const snapshot = await readFoundationOwnerDashboard(current.api, accountId);
  return {
    snapshot,
    profile: presentedDashboardProfile(snapshot, current.account, current.user),
    verificationSteps: dashboardVerificationSteps(snapshot),
    posts: await withDeletionDates(current.api, dashboardPosts(snapshot)),
  };
});
// The dashboard snapshot has no deletion date. Only an ended Market post (the
// snapshot lists at most 10 Market posts) has one, so read it for those from
// the owner's own post read. Without it the row shows no date.
const ENDED = new Set(["expired", "sold", "archived"]);
async function withDeletionDates<T extends { id: string; status: string }>(
  api: FoundationAuthenticatedApi,
  posts: T[]
): Promise<(T & { deletes_at: string | null })[]> {
  return Promise.all(
    posts.map(async (post) => {
      if (!ENDED.has(post.status)) return { ...post, deletes_at: null };
      const owned = await readRestoredOwnerPost(api, post.id).catch(() => null);
      return { ...post, deletes_at: owned?.deletes_at ?? null };
    })
  );
}
const fulfilled = <T>(data: T, count: number | null = null) => ({
  status: "fulfilled" as const,
  value: { data, count, error: null, status: 200, statusText: "OK" },
});
/** Presentation tuple consumed by the existing dashboard rendering. It is not
 * a database client and cannot issue a source-table query. */
export function restoredDashboardResults(
  value: Awaited<ReturnType<typeof readRestoredOwnerDashboard>>
) {
  const { snapshot: s, profile, verificationSteps, posts } = value;
  return [
    fulfilled(profile),
    fulfilled(verificationSteps),
    fulfilled(posts),
    fulfilled(null, s.unread_leads),
    fulfilled(null, s.counts.active_listings),
    fulfilled(null, s.counts.active_events),
    fulfilled(null, s.counts.rejected_listings),
    fulfilled(null, s.counts.pending_listings),
    fulfilled(null, s.counts.expiring_listings),
    fulfilled(null, s.counts.expiring_events),
    fulfilled(null, s.counts.businesses),
    fulfilled(null, s.counts.tourism_businesses),
    fulfilled(s.paid_plans),
    fulfilled(null, s.organisation_admin_count),
    fulfilled(s.recent_leads),
    // The replacement backend has no CIPC/Seen sticker facts. Do not invent
    // verification timestamps or tell an already-reviewed business it failed.
    fulfilled([]),
  ] as const;
}
