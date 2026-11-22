import "server-only";
import { foundationServerPublicApi } from "@/lib/foundation/server-public";
import {
  searchFoundationCards,
  foundationMediaUrl,
  loadFoundationShowroom,
  type FoundationShowroomRequest,
} from "@/lib/foundation/public-cards";
import {
  resolveRestoredLocality,
  resolveRestoredProvince,
} from "@/lib/foundation/restored-locality";
import { normalizeProvinceName, resolveCityName } from "@/lib/constants/sa-provinces";
import { resolveIpGeolocation } from "@/lib/services/ip-geolocation";
import type { CarouselItem } from "@/components/showrooms/showroom-card-carousel";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("ShowroomFeed");

/** The showrooms on the home page and each area page. */
export type ShowroomSurface = "home" | "business" | "market" | "tourism";

const SHOWROOM_LIMITS: Record<ShowroomSurface, number> = {
  home: 15,
  business: 7,
  market: 7,
  tourism: 7,
};

/** Each server copy remembers a showroom order (or that reading it failed) for
 * a minute per showroom and area, so a visit never waits on more than one
 * fair-order read a minute. */
const CACHE_MS = 60_000;
/** At most this many remembered orders (4 showrooms x areas); the oldest goes first. */
const CACHE_ENTRIES = 400;
const cache = new Map<string, { at: number; items: CarouselItem[] | null }>();

/** "New" in the card's badge spot: gold with dark green text (brand accents). */
const NEW_TAG = "New";
const NEW_TAG_CLASS = "bg-brand-gold-300 text-brand-green-900 ring-brand-gold-500/40";

type Area = Pick<FoundationShowroomRequest, "province" | "city">;

/**
 * The visitor's rough area from this request's Cloudflare data, as foundation
 * province and city ids: a province and city, a province alone, or nothing
 * (outside South Africa, no data, or a place the site does not list). Read for
 * this page only; never stored.
 */
export function showroomVisitorArea(): Area {
  try {
    const geo = resolveIpGeolocation();
    if (geo?.country !== "ZA") return {};
    const provinceName = normalizeProvinceName(geo.province);
    if (!provinceName) return {};
    const cityName = resolveCityName(provinceName, geo.city);
    if (cityName) {
      try {
        const { p_province, p_city } = resolveRestoredLocality(provinceName, cityName);
        return { province: p_province, city: p_city };
      } catch {
        // A city the site does not list: the province alone.
      }
    }
    const province = resolveRestoredProvince(provinceName);
    return province ? { province } : {};
  } catch {
    return {};
  }
}

function carouselItem(post: {
  id: string;
  kind: "listing" | "business" | "event";
  area: string;
  title: string;
  summary: string;
  locality: string;
  price_cents: string | null;
  preview: { image_key: string | null; video_key: string | null };
  is_new?: boolean;
}): CarouselItem {
  return {
    id: post.id,
    type: post.kind === "event" ? "promotion" : post.kind,
    href: `${post.kind === "listing" ? "/listing" : post.area === "business" ? "/mzansi-business" : "/tourism-events"}/${post.id}`,
    title: post.title,
    description: post.summary,
    location: post.locality,
    mediaUrl:
      foundationMediaUrl(post.preview.video_key) ??
      foundationMediaUrl(post.preview.image_key) ??
      undefined,
    mediaKind: post.preview.video_key ? "video" : "image",
    posterUrl: foundationMediaUrl(post.preview.image_key) ?? undefined,
    price: post.price_cents === null ? null : Number(post.price_cents) / 100,
    ...(post.is_new ? { statusLabel: NEW_TAG, statusClassName: NEW_TAG_CLASS } : {}),
  };
}

/** The fair order for the showroom and area, or null when it cannot be read;
 * either is remembered for a minute. */
async function fairOrder(surface: ShowroomSurface, area: Area): Promise<CarouselItem[] | null> {
  const key = `${surface}|${area.province ?? ""}|${area.city ?? ""}`;
  const now = Date.now();
  const kept = cache.get(key);
  if (kept && now - kept.at < CACHE_MS) return kept.items;
  let items: CarouselItem[] | null = null;
  try {
    const cards = await loadFoundationShowroom(foundationServerPublicApi(), {
      showroom: surface,
      ...area,
    });
    items = cards.map(carouselItem);
  } catch (error) {
    log.warn("Fair showroom unavailable; showing the newest posts for a minute", {
      surface,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
  cache.delete(key);
  cache.set(key, { at: now, items });
  if (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  return items;
}

/** The newest posts, as before the fair order (used only when it fails). */
async function newestFirst(surface: ShowroomSurface): Promise<CarouselItem[]> {
  const page = await searchFoundationCards(foundationServerPublicApi(), {
    limit: SHOWROOM_LIMITS[surface],
    ...(surface === "home" ? {} : { area: surface === "tourism" ? "tourism_events" : surface }),
  });
  return page.items.map(carouselItem);
}

/** A different one of the first three at the front on each visit; the rest keep their order. */
function rotateFront(items: CarouselItem[], random: () => number): CarouselItem[] {
  const front = Math.floor(random() * Math.min(3, items.length));
  if (front === 0) return items;
  return [items[front]!, ...items.filter((_, index) => index !== front)];
}

/**
 * Showroom cards for a page: the fair order for the visitor's area (turns,
 * the 3 / 2 / 2 area mix, the New tag), or the newest posts if that read
 * fails. Never throws: on any failure the showroom shows no cards.
 */
export async function loadShowroomItems(
  surface: ShowroomSurface,
  random: () => number = Math.random
): Promise<CarouselItem[]> {
  const fair = await fairOrder(surface, showroomVisitorArea());
  if (fair) return rotateFront(fair, random);
  try {
    return await newestFirst(surface);
  } catch (error) {
    log.warn("Showroom feed unavailable", {
      surface,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return [];
  }
}
