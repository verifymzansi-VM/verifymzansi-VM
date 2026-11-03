import "server-only";
import { cache } from "react";
import { readFoundationServerSession } from "./server-session";
import {
  readFoundationOwnerDashboard,
  presentedDashboardProfile,
  dashboardVerificationSteps,
  dashboardPosts,
} from "./owner-dashboard";

export const readRestoredOwnerDashboard = cache(async (accountId: string) => {
  const current = await readFoundationServerSession();
  if (current.user.id !== accountId) throw new Error("Dashboard account changed");
  const snapshot = await readFoundationOwnerDashboard(current.api, accountId);
  return {
    snapshot,
    profile: presentedDashboardProfile(snapshot, current.account, current.user),
    verificationSteps: dashboardVerificationSteps(snapshot),
    posts: dashboardPosts(snapshot),
  };
});
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
