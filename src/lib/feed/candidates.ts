import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_REF_KINDS } from "@/lib/feed/refs";
import type { FeedRef, FeedTable } from "@/lib/feed/types";
import { applyVisibleExpiryFilter } from "@/lib/posting/visibility";
import { mixLocalFirst, type ShowroomEntry } from "@/lib/showroom/mix";
import { isPlaceholderMarketplaceContent } from "@/lib/utils/placeholder-content";

/** A post that may join a sequence: just enough to filter and order it. */
export interface Candidate {
  table: FeedTable;
  id: string;
  title: string | null;
  description: string | null;
  location_province: string | null;
}

export type CandidateOrder = "recommended" | "newest" | "price_asc" | "price_desc";

export interface CandidateQuery {
  table: FeedTable;
  /** Exact-match filters, e.g. { area: "MZANSI_MARKET", category: "vehicles" }. */
  filter: Record<string, string>;
  /** Only events that have not ended. */
  eventsOnly?: boolean;
  /** Only posts from this province. */
  province?: string | null;
  order?: CandidateOrder;
  /** Already cleaned to letters, numbers and spaces. */
  search?: string | null;
}

const TITLE_COLUMN: Record<FeedTable, string> = {
  listings: "title",
  businesses: "business_name",
  promotions: "title",
};

/**
 * Live, unexpired posts in the same order the public lists use: fair rotation
 * (stable for six hours) by default, with an id tie-break so equal values never
 * swap places between requests.
 */
export async function fetchCandidates(
  supabase: SupabaseClient,
  query: CandidateQuery,
  limit: number
): Promise<Candidate[]> {
  const now = new Date().toISOString();
  let builder = supabase
    .from(query.table)
    .select(`id, ${TITLE_COLUMN[query.table]}, description, location_province`)
    .eq("status", "live");
  for (const [column, value] of Object.entries(query.filter)) builder = builder.eq(column, value);
  if (query.province) builder = builder.eq("location_province", query.province);
  if (query.search) {
    builder = builder.or(
      `${TITLE_COLUMN[query.table]}.ilike.%${query.search}%,description.ilike.%${query.search}%`
    );
  }
  if (query.eventsOnly) builder = builder.or(`end_date.is.null,end_date.gte.${now}`);
  let ordered = applyVisibleExpiryFilter(builder, now);
  switch (query.order ?? "recommended") {
    case "newest":
      ordered = ordered.order("created_at", { ascending: false });
      break;
    case "price_asc":
      ordered = ordered
        .order("price_cents", { ascending: true })
        .order("created_at", { ascending: false });
      break;
    case "price_desc":
      ordered = ordered
        // Posts without a price go last, never first.
        .order("price_cents", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      break;
    default:
      ordered = ordered.order("fair_rotation_key", { ascending: true });
  }
  const { data } = await ordered.order("id", { ascending: true }).limit(limit);
  return ((data ?? []) as unknown as Array<Record<string, string | null>>).map((row) => ({
    table: query.table,
    id: String(row.id),
    title: row[TITLE_COLUMN[query.table]] ?? null,
    description: row.description ?? null,
    location_province: row.location_province ?? null,
  }));
}

/** Alternate ranked lists so a mixed feed (stays and events) takes turns. */
export function interleave<T>(lists: T[][]): T[] {
  const result: T[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < longest; index += 1) {
    for (const list of lists) if (index < list.length) result.push(list[index]);
  }
  return result;
}

/**
 * Drop placeholders and posts already taken, then put the visitor's province
 * first (4 of 7, as the showrooms do) when no province was chosen.
 */
export function orderCandidates(
  candidates: Candidate[],
  options: { seen: Set<string>; localProvince: string | null }
): Candidate[] {
  const fresh = candidates.filter(
    (candidate) =>
      !options.seen.has(candidate.id) &&
      !isPlaceholderMarketplaceContent(candidate.title, candidate.description)
  );
  for (const candidate of fresh) options.seen.add(candidate.id);
  const entries: Array<ShowroomEntry & { candidate: Candidate }> = fresh.map((candidate) => ({
    table: candidate.table,
    id: candidate.id,
    isLocal: Boolean(
      options.localProvince && candidate.location_province === options.localProvince
    ),
    candidate,
  }));
  return (mixLocalFirst(entries, options.localProvince) as typeof entries).map(
    (entry) => entry.candidate
  );
}

export function candidateRefs(candidates: Candidate[]): FeedRef[] {
  return candidates.map((candidate) => ({
    kind: TABLE_REF_KINDS[candidate.table],
    id: candidate.id,
  }));
}
