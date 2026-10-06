/**
 * Seen by VerifyMzansi (spec §4). A verifier schedules a live video call or a
 * visit, reports what they saw with at least three photos, and a different
 * staff member approves. Visited addresses and photos are never public.
 */

export const MIN_SEEN_PHOTOS = 3;

export const PREMISES_TYPES = [
  "shop",
  "home_based",
  "market_stall",
  "mobile_service",
  "online_with_stock",
  "office",
] as const;

export type SeenPhoto = {
  fileId: string;
  takenAt: string;
  lat: number | null;
  lng: number | null;
  by: string;
};

export type SeenReport = {
  outcome: "seen" | "not_confirmed";
  identityConfirmed: boolean;
  signage: boolean;
  productsSeen: string;
  premisesType: (typeof PREMISES_TYPES)[number];
  notes: string | null;
  /** Visits: the town or city seen; falls back to the profile's city. */
  city?: string | null;
  by: string;
  at: string;
};

export type SeenState = {
  method: "video" | "visit";
  address?: string | null;
  slots?: string[];
  consentScreenshots?: boolean;
  assignedTo?: string | null;
  scheduledFor?: string | null;
  photos?: SeenPhoto[];
  report?: SeenReport | null;
};

/** What an approval of a Seen case still needs. */
export function seenApprovalGaps(seen: SeenState | null, approverId: string): string[] {
  const gaps: string[] = [];
  if (!seen?.report) {
    gaps.push("The verifier hasn't submitted a report yet.");
    return gaps;
  }
  if (seen.report.by === approverId) {
    gaps.push("A different staff member must approve the report you wrote.");
  }
  if (seen.report.outcome !== "seen") gaps.push("The verifier could not confirm the business.");
  if (!seen.report.identityConfirmed)
    gaps.push("The person seen didn't show an ID matching the owner's verified name.");
  if ((seen.photos?.length ?? 0) < MIN_SEEN_PHOTOS) {
    gaps.push(`Add at least ${MIN_SEEN_PHOTOS} photos or screenshots.`);
  }
  return gaps;
}
