import "server-only";

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyVisibleExpiryFilter } from "@/lib/posting/visibility";
import { isPlaceholderMarketplaceContent } from "@/lib/utils/placeholder-content";
import { shouldHidePlaywrightFixtureRowWhenEnabled } from "@/components/home/playwright-fixture-filter";
import {
  businessToCarouselItem,
  listingToCarouselItem,
  promotionToCarouselItem,
  type CarouselItem,
} from "@/components/showrooms/carousel-item-transforms";
import { createLogger } from "@/lib/utils/logger";
import { mixLocalFirst, type ShowroomEntry } from "./mix";

const log = createLogger("ShowroomFeed");

/**
 * Fair showroom rotation. Everyone pays the same, so every live post gets an
 * equal turn: the database ranks posts by how far below their fair share of
 * showroom appearances they are (last 7 days), gives new posts a 72-hour
 * starter window, and offers posts from the visitor's province first. See
 * supabase/migrations/20261002135904_fair_showroom_rotation.sql.
 */
export type ShowroomSurface = "home" | "business" | "market" | "tourism";

export const SHOWROOM_LIMITS: Record<ShowroomSurface, number> = {
  home: 15,
  business: 7,
  market: 7,
  tourism: 7,
};

type ContentTable = ShowroomEntry["table"];

// Explicit public columns only; owner_id is read for the e2e fixture filter.
const COLUMNS: Record<ContentTable, string> = {
  businesses:
    "id, owner_id, business_name, logo_url, cover_photo, cover_video, video_thumbnail, description, category, location_city, location_province, focal_x, focal_y, media_width, media_height",
  listings:
    "id, owner_id, title, description, price_cents, photos, videos, video_thumbnail, logo_url, location_city, location_province, category, focal_x, focal_y, media_width, media_height",
  promotions:
    "id, owner_id, title, description, promotion_type, category, category_key, photos, videos, video_thumbnail, location_city, location_province, price_cents, focal_x, focal_y, media_width, media_height",
};

/** How many leading posts take turns at the front between ranking refreshes. */
const FRONT_POOL_SIZE = 3;
/** Candidates fetched per side (local / national) before mixing. */
const CANDIDATE_LIMIT = 30;
/**
 * The ranking is recomputed at most once a minute per showroom and province
 * on each server instance: heavy traffic reads a cached order instead of
 * re-ranking on every visit, and the order still moves every minute.
 */
const ORDER_TTL_MS = 60_000;
const ORDER_CACHE_MAX = 200;
/** After a failed ranking, wait this long before asking the database again. */
const FAILURE_BACKOFF_MS = 15_000;
const orderCache = new Map<string, { at: number; entries: ShowroomEntry[] | null }>();
/** One ranking query per showroom and province at a time (no stampede on expiry). */
const inFlight = new Map<string, Promise<ShowroomEntry[] | null>>();

type Row = Record<string, unknown> & { id: string };

/** Any Supabase client that can read the public post tables. */
export type ShowroomClient = SupabaseClient;

let sharedPublicClient: SupabaseClient | null = null;

function publicClient(): SupabaseClient | null {
  if (sharedPublicClient) return sharedPublicClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  try {
    if (!["http:", "https:"].includes(new URL(url).protocol)) return null;
  } catch {
    return null;
  }
  sharedPublicClient = createSupabaseClient(url, anonKey, { auth: { persistSession: false } });
  return sharedPublicClient;
}

async function fetchRankedOrder(
  surface: ShowroomSurface,
  province: string | null
): Promise<ShowroomEntry[] | null> {
  try {
    const { data, error } = await createAdminClient().rpc("get_showroom_feed", {
      p_surface: surface,
      p_province: province,
      p_limit: CANDIDATE_LIMIT,
    });
    if (error || !Array.isArray(data)) {
      log.warn("Showroom ranking unavailable; using newest first", {
        surface,
        error: error?.message,
      });
      return null;
    }
    return (data as { content_table: ContentTable; content_id: string; is_local: boolean }[]).map(
      (row) => ({ table: row.content_table, id: row.content_id, isLocal: row.is_local })
    );
  } catch (error) {
    log.warn("Showroom ranking failed; using newest first", {
      surface,
      error: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

async function loadRankedOrder(
  surface: ShowroomSurface,
  province: string | null
): Promise<ShowroomEntry[] | null> {
  const key = `${surface}:${province ?? ""}`;
  const cached = orderCache.get(key);
  if (cached && Date.now() - cached.at < ORDER_TTL_MS) return cached.entries;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = fetchRankedOrder(surface, province)
    .then((entries) => {
      if (orderCache.size >= ORDER_CACHE_MAX) orderCache.clear();
      if (entries) {
        orderCache.set(key, { at: Date.now(), entries });
        return entries;
      }
      // Keep serving the last good order (or newest first) and back off, so a
      // struggling database is not asked again by every visitor.
      const stale = cached?.entries ?? null;
      orderCache.set(key, { at: Date.now() - ORDER_TTL_MS + FAILURE_BACKOFF_MS, entries: stale });
      return stale;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

/** Newest-first fallback that mirrors the pages' own public filters. */
async function loadNewestFirst(
  supabase: SupabaseClient,
  surface: ShowroomSurface,
  limit: number
): Promise<ShowroomEntry[]> {
  const now = new Date().toISOString();
  const queries: Array<PromiseLike<{ data: unknown[] | null }>> = [];
  const tables: ContentTable[] = [];

  if (surface !== "market") {
    let query = supabase.from("businesses").select("id, created_at").eq("status", "live");
    if (surface === "business") query = query.eq("area", "MZANSI_BUSINESS");
    if (surface === "tourism") query = query.eq("category", "tourism_hospitality");
    queries.push(
      applyVisibleExpiryFilter(query, now).order("created_at", { ascending: false }).limit(limit)
    );
    tables.push("businesses");
  }
  if (surface === "home" || surface === "market") {
    const query = supabase
      .from("listings")
      .select("id, created_at")
      .eq("status", "live")
      .eq("area", "MZANSI_MARKET");
    queries.push(
      applyVisibleExpiryFilter(query, now).order("created_at", { ascending: false }).limit(limit)
    );
    tables.push("listings");
  }
  if (surface === "home" || surface === "tourism") {
    let query = supabase.from("promotions").select("id, created_at").eq("status", "live");
    if (surface === "tourism") {
      query = query.eq("promotion_type", "event").or(`end_date.is.null,end_date.gte.${now}`);
    }
    queries.push(
      applyVisibleExpiryFilter(query, now).order("created_at", { ascending: false }).limit(limit)
    );
    tables.push("promotions");
  }

  const results = await Promise.all(
    queries.map((query) => Promise.resolve(query).catch(() => ({ data: null })))
  );
  return results
    .flatMap((result, index) =>
      ((result.data ?? []) as { id: string; created_at?: string }[]).map((row) => ({
        table: tables[index],
        id: row.id,
        isLocal: false,
        createdAt: row.created_at ?? "",
      }))
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(({ table, id, isLocal }) => ({ table, id, isLocal }));
}

function toCarouselItem(table: ContentTable, row: Row): CarouselItem {
  if (table === "businesses") {
    return businessToCarouselItem(row as unknown as Parameters<typeof businessToCarouselItem>[0]);
  }
  if (table === "listings") {
    return listingToCarouselItem(row as unknown as Parameters<typeof listingToCarouselItem>[0]);
  }
  return promotionToCarouselItem(row as unknown as Parameters<typeof promotionToCarouselItem>[0]);
}

function titleOf(row: Row): string {
  return String(row.business_name ?? row.title ?? "");
}

/**
 * The ranking is cached for a minute, so without this every visitor in that
 * minute would see the same post at the front, where most attention goes.
 * Each visit puts one of the top 3 (of the same local/national kind as the
 * leader) first; the ranking itself is untouched.
 */
export function varyFrontCard(entries: ShowroomEntry[], random = Math.random): ShowroomEntry[] {
  const leaderIsLocal = entries[0]?.isLocal;
  const pool = entries
    .slice(0, FRONT_POOL_SIZE)
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.isLocal === leaderIsLocal);
  if (pool.length <= 1) return entries;
  const pick = pool[Math.floor(random() * pool.length)].index;
  if (pick === 0) return entries;
  return [entries[pick], ...entries.slice(0, pick), ...entries.slice(pick + 1)];
}

/**
 * Showroom cards for a page, in fair rotation order, local posts first.
 * Never throws: on any failure the showroom falls back to newest first.
 */
export async function loadShowroomItems(
  surface: ShowroomSurface,
  options: {
    province: string | null;
    hideFixtures?: boolean;
    /** The page's own public client (keeps e2e fixtures working); default: anon. */
    client?: SupabaseClient;
  }
): Promise<CarouselItem[]> {
  const limit = SHOWROOM_LIMITS[surface];
  const supabase = options.client ?? publicClient();
  if (!supabase) return [];

  const ranked = await loadRankedOrder(surface, options.province);
  const ordered = ranked
    ? mixLocalFirst(ranked, options.province)
    : await loadNewestFirst(supabase, surface, limit * 2).catch(() => []);
  // Read a few spare rows: placeholder and fixture rows are dropped below.
  const wanted = varyFrontCard(ordered).slice(0, limit + 5);
  if (wanted.length === 0) return [];

  const byTable = new Map<ContentTable, string[]>();
  for (const entry of wanted) {
    byTable.set(entry.table, [...(byTable.get(entry.table) ?? []), entry.id]);
  }

  const rows = new Map<string, Row>();
  await Promise.all(
    [...byTable.entries()].map(async ([table, ids]) => {
      try {
        // The ranking can be a minute old; never show a post that has since
        // gone offline (its owner's session could still read it).
        const { data } = await supabase
          .from(table)
          .select(COLUMNS[table])
          .eq("status", "live")
          .in("id", ids);
        for (const row of (data ?? []) as unknown as Row[]) rows.set(`${table}:${row.id}`, row);
      } catch {
        // A failed table only removes its cards; the rest still render.
      }
    })
  );

  const items: CarouselItem[] = [];
  for (const entry of wanted) {
    const row = rows.get(`${entry.table}:${entry.id}`);
    if (!row) continue;
    if (shouldHidePlaywrightFixtureRowWhenEnabled(row, Boolean(options.hideFixtures))) continue;
    if (isPlaceholderMarketplaceContent(titleOf(row), row.description as string | null)) continue;
    items.push(toCarouselItem(entry.table, row));
    if (items.length >= limit) break;
  }
  return items;
}

/** Test helper. */
export function clearShowroomOrderCacheForTests() {
  orderCache.clear();
  inFlight.clear();
}
