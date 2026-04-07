import type { SupabaseClient } from "@supabase/supabase-js";
import { FREE_POST_CONFIG } from "@/lib/constants/pricing";
import type { MarketplaceArea } from "@/types/enums";

export type FreePostUsage = {
  used: number;
  remaining: number;
  available: boolean;
};

export type ClaimFreePostSlotArgs = {
  userId: string;
  area: MarketplaceArea;
  contentId: string;
  maxAllowed?: number;
};

export type ReleaseFreePostSlotArgs = {
  userId: string;
  area: MarketplaceArea;
  contentId: string;
  reason: string;
};

function toUsage(used: number, maxAllowed: number): FreePostUsage {
  const normalizedUsed = Math.max(0, used);
  const remaining = Math.max(0, maxAllowed - normalizedUsed);

  return {
    used: normalizedUsed,
    remaining,
    available: remaining > 0,
  };
}

export async function getActiveFreePostUsage(
  client: SupabaseClient,
  userId: string,
  area: MarketplaceArea,
  maxAllowed = Number(FREE_POST_CONFIG.maxAllowed)
): Promise<FreePostUsage> {
  const { count, error } = await client
    .from("free_posts_used")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("area", area)
    .is("released_at", null);

  if (error) {
    throw new Error(error.message);
  }

  return toUsage(count ?? 0, maxAllowed);
}

export async function claimFreePostSlot(
  admin: SupabaseClient,
  {
    userId,
    area,
    contentId,
    maxAllowed = Number(FREE_POST_CONFIG.maxAllowed),
  }: ClaimFreePostSlotArgs
): Promise<boolean> {
  if (typeof admin.rpc === "function") {
    const { data, error } = await admin.rpc("claim_free_post_slot", {
      p_user_id: userId,
      p_area: area,
      p_content_id: contentId,
      p_max_allowed: maxAllowed,
    });

    if (error) {
      throw new Error(error.message);
    }

    return data === true;
  }

  const { error } = await admin.from("free_posts_used").insert({
    user_id: userId,
    area,
    content_id: contentId,
  });

  if (error) {
    if (error.code === "23505") {
      return false;
    }
    throw new Error(error.message);
  }

  return true;
}

export async function releaseFreePostSlot(
  admin: SupabaseClient,
  { userId, area, contentId, reason }: ReleaseFreePostSlotArgs
): Promise<boolean> {
  const freePostsTable = admin.from("free_posts_used");

  if (typeof freePostsTable.update === "function") {
    const { data, error } = await freePostsTable
      .update({
        released_at: new Date().toISOString(),
        release_reason: reason,
      })
      .eq("user_id", userId)
      .eq("area", area)
      .eq("content_id", contentId)
      .is("released_at", null)
      .select("id")
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return !!data;
  }

  if (typeof freePostsTable.delete === "function") {
    const { error } = await freePostsTable
      .delete()
      .eq("user_id", userId)
      .eq("area", area)
      .eq("content_id", contentId);

    if (error) {
      throw new Error(error.message);
    }

    return true;
  }

  throw new Error("free_posts_used release is not supported by this Supabase client");
}

export async function releaseRejectedDeletedFreePost(
  admin: SupabaseClient,
  userId: string,
  area: MarketplaceArea,
  contentId: string
): Promise<boolean> {
  return releaseFreePostSlot(admin, {
    userId,
    area,
    contentId,
    reason: "rejected_deleted",
  });
}
