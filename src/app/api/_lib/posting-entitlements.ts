import { NextResponse } from "next/server";

import { FREE_POST_CONFIG } from "@/lib/constants/pricing";
import { getEntitlements } from "@/lib/services/entitlements";
import type { AppLogger } from "@/lib/utils/logger";
import type { PlanTier } from "@/types/enums";

type EntitlementQueryClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string
      ) => {
        eq: (
          column: string,
          value: string
        ) => {
          eq: (
            column: string,
            value: string
          ) => {
            gt: (
              column: string,
              value: string
            ) => {
              order: (
                column: string,
                options: { ascending: boolean }
              ) => {
                limit: (count: number) => {
                  maybeSingle: () => Promise<{
                    data: { tier?: string | null } | null;
                    error: { message: string } | null;
                  }>;
                };
              };
            };
          };
        };
      };
    };
  };
};

type PostingEntitlementsResult =
  | {
      entitlements: {
        maxPhotos: number;
        maxVideos: number;
        videoAllowed: boolean;
      };
      response?: never;
    }
  | {
      entitlements?: never;
      response: NextResponse;
    };

export async function getPostingEntitlementsOrResponse(
  supabase: EntitlementQueryClient,
  userId: string,
  area: string,
  log: AppLogger
): Promise<PostingEntitlementsResult> {
  const { data: activeEntitlement, error: entitlementError } = await supabase
    .from("entitlements")
    .select("tier")
    .eq("user_id", userId)
    .eq("area", area)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (entitlementError) {
    log.error("Failed to check entitlements", {
      userId,
      error: entitlementError.message,
    });
    return {
      response: NextResponse.json(
        { error: "Unable to verify subscription status" },
        { status: 503 }
      ),
    };
  }

  const hasPaidPlan = !!activeEntitlement;
  const activeTier = (activeEntitlement?.tier as string) || null;

  return {
    entitlements:
      hasPaidPlan && activeTier
        ? getEntitlements(activeTier as PlanTier, area)
        : {
            maxPhotos: FREE_POST_CONFIG.maxPhotos,
            maxVideos: FREE_POST_CONFIG.maxVideos,
            videoAllowed: FREE_POST_CONFIG.videoAllowed,
          },
  };
}
