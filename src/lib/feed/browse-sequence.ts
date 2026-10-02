import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FeedBrowse } from "@/lib/feed/browse";
import {
  candidateRefs,
  fetchCandidates,
  interleave,
  orderCandidates,
  type CandidateQuery,
} from "@/lib/feed/candidates";
import type { FeedRef } from "@/lib/feed/types";

/** One browse fills a whole viewer session at once, so its order is frozen. */
const BROWSE_LIMIT = 200;

function queriesFor(browse: FeedBrowse): CandidateQuery[] {
  const base = { province: browse.province, order: browse.sort, search: browse.query };
  if (browse.vertical === "market") {
    return [
      {
        ...base,
        table: "listings",
        filter: {
          area: "MZANSI_MARKET",
          ...(browse.category ? { category: browse.category } : {}),
          ...(browse.condition ? { condition: browse.condition } : {}),
        },
      },
    ];
  }
  // Price sorts only exist for listings; businesses fall back to their own order.
  const order = browse.sort === "newest" ? "newest" : "recommended";
  if (browse.vertical === "business") {
    return [
      {
        ...base,
        order,
        table: "businesses",
        filter: {
          area: "MZANSI_BUSINESS",
          ...(browse.category ? { category: browse.category } : {}),
        },
      },
    ];
  }
  const stays: CandidateQuery = {
    ...base,
    order,
    table: "businesses",
    filter: {
      category: "tourism_hospitality",
      ...(browse.category ? { subcategory: browse.category } : {}),
    },
  };
  const events: CandidateQuery = {
    ...base,
    order,
    table: "promotions",
    eventsOnly: true,
    filter: {
      promotion_type: "event",
      ...(browse.eventType ? { "event_details->>event_type": browse.eventType } : {}),
    },
  };
  // A stay type or an event type narrows the feed to that kind on its own.
  if (browse.kind === "stays" || (browse.category && !browse.eventType)) return [stays];
  if (browse.kind === "events" || (browse.eventType && !browse.category)) return [events];
  return [stays, events];
}

export interface BrowseSequence {
  refs: FeedRef[];
  /** Every matching post is in `refs`; false when the list was cut at the session size. */
  exhausted: boolean;
}

/**
 * The posts a section, province and filter choice covers, in the same fair
 * rotation as the public lists (or the chosen sort). Without a province the
 * visitor's own province comes first; with one, only that province is shown.
 */
export async function buildBrowseSequence(
  supabase: SupabaseClient,
  browse: FeedBrowse,
  visitorProvince: string | null
): Promise<BrowseSequence> {
  const queries = queriesFor(browse);
  const lists = await Promise.all(
    queries.map((query) => fetchCandidates(supabase, query, BROWSE_LIMIT + 1))
  );
  const truncated = lists.some((list) => list.length > BROWSE_LIMIT);
  // A chosen sort (newest, price) is followed exactly; only the fair default mixes local posts first.
  const localProvince = browse.province || browse.sort !== "recommended" ? null : visitorProvince;
  const ordered = orderCandidates(interleave(lists), { seen: new Set(), localProvince });
  return {
    refs: candidateRefs(ordered.slice(0, BROWSE_LIMIT)),
    exhausted: !truncated && ordered.length <= BROWSE_LIMIT,
  };
}
