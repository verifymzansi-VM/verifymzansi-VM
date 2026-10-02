import { type createClient } from "@/lib/supabase/server";
import { applyVisibleExpiryFilter } from "@/lib/posting/visibility";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const TOURISM_HOSPITALITY_CATEGORY = "tourism_hospitality" as const;

// `select` is deliberately required (no "*" default): these builders feed
// public pages, so every caller must name the columns it is allowed to expose.
// The runtime check also catches untyped callers: postgrest-js treats an
// undefined select as "*".
function assertExplicitSelect(select: string): string {
  if (typeof select !== "string" || !select.trim() || select.includes("*")) {
    throw new Error("Public tourism/event queries require an explicit column list");
  }
  return select;
}

export function buildPublicTourismBusinessesQuery(supabase: SupabaseServerClient, select: string) {
  return (
    applyVisibleExpiryFilter(
      supabase
        .from("businesses")
        .select(assertExplicitSelect(select))
        .eq("status", "live")
        .eq("category", TOURISM_HOSPITALITY_CATEGORY)
    )
      // Fair rotation: new posts first for 72 hours, then everyone takes turns.
      .order("fair_rotation_key", { ascending: true })
      .order("id", { ascending: true })
  );
}

export function buildPublicEventPromotionsQuery(
  supabase: SupabaseServerClient,
  nowIso: string,
  select: string
) {
  return applyVisibleExpiryFilter(
    supabase
      .from("promotions")
      .select(assertExplicitSelect(select))
      .eq("status", "live")
      .eq("promotion_type", "event")
      .or(`end_date.is.null,end_date.gte.${nowIso}`),
    nowIso
  )
    .order("fair_rotation_key", { ascending: true })
    .order("id", { ascending: true });
}
