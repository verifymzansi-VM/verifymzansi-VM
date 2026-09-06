import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketplaceArea } from "@/types/enums";
export type IntroTrialOffer = {
  eligible: boolean;
  sevenDayAvailable: boolean;
  thirtyDayAvailable: boolean;
  remaining: number;
  launchEnabled: boolean;
};
export type FreePostUsage = {
  used: number;
  remaining: number;
  available: boolean;
  offer?: IntroTrialOffer;
};
export type ClaimFreePostSlotArgs = {
  userId: string;
  area: MarketplaceArea;
  contentId: string;
  durationDays?: 7 | 30;
};
export type ReleaseFreePostSlotArgs = {
  userId: string;
  area: MarketplaceArea;
  contentId: string;
  reason: string;
};
export async function getActiveFreePostUsage(
  client: SupabaseClient,
  _userId: string,
  area: MarketplaceArea
): Promise<FreePostUsage> {
  // Eligibility is bound to auth.uid(), never to a browser-supplied user ID.
  const { data, error } = await client.rpc("intro_trial_offer", { p_area: area });
  if (error || !data) throw new Error("Unable to check introductory offer");
  const offer = data as IntroTrialOffer;
  const available = offer.eligible && (offer.sevenDayAvailable || offer.thirtyDayAvailable);
  return { used: offer.eligible ? 0 : 1, remaining: available ? 1 : 0, available, offer };
}
export async function claimFreePostSlot(
  admin: SupabaseClient,
  { userId, area, contentId, durationDays = 7 }: ClaimFreePostSlotArgs
): Promise<boolean> {
  const { data, error } = await admin.rpc("reserve_intro_trial", {
    p_user_id: userId,
    p_area: area,
    p_content_id: contentId,
    p_duration_days: durationDays,
  });
  if (error) throw new Error(error.message);
  return data === true;
}
export async function releaseFreePostSlot(
  admin: SupabaseClient,
  { userId, area, contentId, reason }: ReleaseFreePostSlotArgs
): Promise<boolean> {
  const { data, error } = await admin.rpc("release_intro_trial", {
    p_user_id: userId,
    p_area: area,
    p_content_id: contentId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  return data === true;
}
export function releaseRejectedDeletedFreePost(
  admin: SupabaseClient,
  userId: string,
  area: MarketplaceArea,
  contentId: string
): Promise<boolean> {
  return releaseFreePostSlot(admin, { userId, area, contentId, reason: "rejected_deleted" });
}
export function trialAvailabilityMessage(offer: IntroTrialOffer): string {
  if (!offer.launchEnabled) return "The 30-day launch offer is currently paused.";
  if (offer.remaining === 0) return "30-day free spaces are currently fully allocated.";
  if (offer.remaining <= 10) return `Only ${offer.remaining} free 30-day spaces remaining.`;
  return "Limited 30-day free spaces available.";
}
