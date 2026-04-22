import { type createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const TOURISM_HOSPITALITY_CATEGORY = "tourism_hospitality" as const;

export function buildPublicTourismBusinessesQuery(supabase: SupabaseServerClient, select = "*") {
  return supabase
    .from("businesses")
    .select(select)
    .eq("status", "live")
    .eq("category", TOURISM_HOSPITALITY_CATEGORY)
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("featured_until", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
}

export function buildPublicEventPromotionsQuery(
  supabase: SupabaseServerClient,
  nowIso: string,
  select = "*"
) {
  return supabase
    .from("promotions")
    .select(select)
    .eq("status", "live")
    .eq("promotion_type", "event")
    .or(`end_date.is.null,end_date.gte.${nowIso}`)
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("featured_until", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
}
