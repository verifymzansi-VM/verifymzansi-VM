import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  candidateRefs,
  fetchCandidates,
  interleave,
  orderCandidates,
  type Candidate,
} from "@/lib/feed/candidates";
import type { FeedRef, FeedTable } from "@/lib/feed/types";

/** How many recommendations one request returns. */
const DIRECT_BATCH = 120;

type Scope = {
  table: FeedTable;
  /** Narrow (same category) filter, then the wider vertical filter. */
  narrow: Record<string, string> | null;
  wide: Record<string, string>;
  eventsOnly?: boolean;
};

interface CurrentPost {
  table: FeedTable;
  id: string;
  scopes: Scope[];
}

async function resolveCurrent(supabase: SupabaseClient, ref: FeedRef): Promise<CurrentPost | null> {
  if (ref.kind === "l") {
    const { data } = await supabase
      .from("listings")
      .select("id, category")
      .eq("id", ref.id)
      .maybeSingle();
    if (!data) return null;
    const market = { area: "MZANSI_MARKET" };
    return {
      table: "listings",
      id: data.id,
      scopes: [
        {
          table: "listings",
          narrow: data.category ? { ...market, category: data.category } : null,
          wide: market,
        },
      ],
    };
  }

  if (ref.kind === "b" || ref.kind === "t") {
    const { data } = await supabase
      .from("businesses")
      .select("id, category, subcategory, area")
      .eq("id", ref.id)
      .maybeSingle();
    if (data) {
      const tourism = data.category === "tourism_hospitality" || data.area === "PROMOTIONS_EVENTS";
      if (tourism) {
        const base = { category: "tourism_hospitality" };
        return {
          table: "businesses",
          id: data.id,
          scopes: [
            {
              table: "businesses",
              narrow: data.subcategory ? { ...base, subcategory: data.subcategory } : null,
              wide: base,
            },
            {
              table: "promotions",
              narrow: null,
              wide: { promotion_type: "event" },
              eventsOnly: true,
            },
          ],
        };
      }
      const area = { area: "MZANSI_BUSINESS" };
      return {
        table: "businesses",
        id: data.id,
        scopes: [
          {
            table: "businesses",
            narrow: data.category ? { ...area, category: data.category } : null,
            wide: area,
          },
        ],
      };
    }
    if (ref.kind === "b") return null;
  }

  const { data } = await supabase
    .from("promotions")
    .select("id, category_key, promotion_type")
    .eq("id", ref.id)
    .maybeSingle();
  if (!data) return null;
  const events = { promotion_type: data.promotion_type ?? "event" };
  return {
    table: "promotions",
    id: data.id,
    scopes: [
      {
        table: "promotions",
        narrow: data.category_key ? { ...events, category_key: data.category_key } : null,
        wide: events,
        eventsOnly: data.promotion_type === "event",
      },
      { table: "businesses", narrow: null, wide: { category: "tourism_hospitality" } },
    ],
  };
}

export interface DirectSequence {
  refs: FeedRef[];
  /** True when every matching post was returned (the feed can truly end). */
  exhausted: boolean;
}

/**
 * Recommendations after a post opened without a list: the same category in fair
 * rotation, the visitor's province mixed in first (4 of 7), then the whole
 * vertical. Live, unexpired, non-placeholder posts only; never the post itself.
 */
export async function buildDirectSequence(
  supabase: SupabaseClient,
  ref: FeedRef,
  province: string | null
): Promise<DirectSequence | null> {
  const current = await resolveCurrent(supabase, ref);
  if (!current) return null;

  const seen = new Set<string>([current.id]);
  const ordered: Candidate[] = [];
  let exhausted = true;
  const take = (candidates: Candidate[]) =>
    ordered.push(...orderCandidates(candidates, { seen, localProvince: province }));

  const [primary, ...secondary] = current.scopes;
  if (primary.narrow) {
    const narrow = await fetchCandidates(
      supabase,
      { table: primary.table, filter: primary.narrow, eventsOnly: primary.eventsOnly },
      DIRECT_BATCH
    );
    if (narrow.length >= DIRECT_BATCH) exhausted = false;
    take(narrow);
  }
  if (ordered.length < DIRECT_BATCH) {
    const wideLimit = DIRECT_BATCH + 1;
    const lists = await Promise.all(
      [primary, ...secondary].map((scope) =>
        fetchCandidates(
          supabase,
          { table: scope.table, filter: scope.wide, eventsOnly: scope.eventsOnly },
          wideLimit
        )
      )
    );
    if (lists.some((list) => list.length >= wideLimit)) exhausted = false;
    take(interleave(lists));
  }

  return {
    refs: candidateRefs(ordered.slice(0, DIRECT_BATCH)),
    exhausted: exhausted && ordered.length <= DIRECT_BATCH,
  };
}
