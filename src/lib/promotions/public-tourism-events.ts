import { type createClient } from "@/lib/supabase/server";
import { applyVisibleExpiryFilter } from "@/lib/posting/visibility";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const TOURISM_HOSPITALITY_CATEGORY = "tourism_hospitality" as const;

export function buildPublicTourismBusinessesQuery(supabase: SupabaseServerClient, select = "*") {
  return applyVisibleExpiryFilter(
    supabase
      .from("businesses")
      .select(select)
      .eq("status", "live")
      .eq("category", TOURISM_HOSPITALITY_CATEGORY)
  )
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("featured_until", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
}

export function buildPublicEventPromotionsQuery(
  supabase: SupabaseServerClient,
  nowIso: string,
  select = "*"
) {
  return applyVisibleExpiryFilter(
    supabase
      .from("promotions")
      .select(select)
      .eq("status", "live")
      .eq("promotion_type", "event")
      .or(`end_date.is.null,end_date.gte.${nowIso}`),
    nowIso
  )
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("featured_until", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
}
