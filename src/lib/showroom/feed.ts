import "server-only";
import { foundationServerPublicApi } from "@/lib/foundation/server-public";
import {
  searchFoundationPresentedCards,
  foundationMediaUrl,
  loadFoundationShowroom,
  type FoundationCardPresentation,
  type FoundationShowroomCard,
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
 * a minute per showroom and area, and each card's presentation (or that it has
 * none) for a minute per post, so the database sees at most one fair-order
 * read per showroom and area and one presentation read per post a minute. */
const CACHE_MS = 60_000;
/** At most this many remembered orders (4 showrooms x areas); the oldest goes first. */
const CACHE_ENTRIES = 400;
const orders = new Map<string, { at: number; cards: FoundationShowroomCard[] | null }>();
/** At most this many remembered card presentations; the oldest goes first. */
const PRESENTATION_ENTRIES = 1_000;
const presentations = new Map<string, { at: number; presentation?: FoundationCardPresentation }>();
/** A visit waits at most this long for the card presentations it has to read.
 * A card still unanswered shows its preview picture alone; its answer, when it
 * comes, is remembered, and the next visit reads it again if it never comes. */
const PRESENTATION_DEADLINE_MS = 1_500;
/** One fair-order read per showroom and area at a time: simultaneous visits
 * share it. Each visit reads its card presentations itself, so its 1.5 s wait
 * never depends on another request. */
const orderReads = new Map<string, Promise<FoundationShowroomCard[] | null>>();

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

/** The owner's first picture of one purpose (a video's chosen frame or the
 * post's logo), as its media address, or undefined. */
function presentedMediaUrl(
  presentation: FoundationCardPresentation | undefined,
  purpose: "poster" | "logo"
) {
  const first = (presentation?.frontend?.media ?? [])
    .filter((media) => media.purpose === purpose)
    .sort((a, b) => a.position - b.position)[0];
  return foundationMediaUrl(first?.object_key) ?? undefined;
}

function carouselItem(
  post: {
    id: string;
    kind: "listing" | "business" | "event";
    area: string;
    title: string;
    summary: string;
    locality: string;
    price_cents: string | null;
    preview: { image_key: string | null; video_key: string | null };
    is_new?: boolean;
  },
  presentation?: FoundationCardPresentation
): CarouselItem {
  const logoUrl = presentedMediaUrl(presentation, "logo");
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
    // A video-only post has no preview picture: its chosen frame stands in, so
    // the card plays the video over that frame instead of fallback artwork.
    posterUrl:
      foundationMediaUrl(post.preview.image_key) ?? presentedMediaUrl(presentation, "poster"),
    ...(logoUrl ? { logoUrl } : {}),
    price: post.price_cents === null ? null : Number(post.price_cents) / 100,
    ...(post.is_new ? { statusLabel: NEW_TAG, statusClassName: NEW_TAG_CLASS } : {}),
  };
}

/** Puts a value last in a bounded map, dropping the oldest past the limit. */
function remember<V>(map: Map<string, V>, key: string, value: V, limit: number) {
  map.delete(key);
  map.set(key, value);
  if (map.size > limit) map.delete(map.keys().next().value!);
}

/** The fair order's cards for the showroom and area, or null when they cannot
 * be read; either is remembered for a minute. Simultaneous visits share one
 * read (see orderReads). */
async function fairCards(
  surface: ShowroomSurface,
  area: Area,
  key: string
): Promise<FoundationShowroomCard[] | null> {
  const kept = orders.get(key);
  if (kept && Date.now() - kept.at < CACHE_MS) return kept.cards;
  const running = orderReads.get(key);
  if (running) return running;
  const read = readFairCards(surface, area, key);
  orderReads.set(key, read);
  try {
    return await read;
  } finally {
    if (orderReads.get(key) === read) orderReads.delete(key);
  }
}

async function readFairCards(
  surface: ShowroomSurface,
  area: Area,
  key: string
): Promise<FoundationShowroomCard[] | null> {
  const now = Date.now();
  let cards: FoundationShowroomCard[] | null = null;
  try {
    cards = await loadFoundationShowroom(foundationServerPublicApi(), {
      showroom: surface,
      ...area,
    });
  } catch (error) {
    log.warn("Fair showroom unavailable; showing the newest posts for a minute", {
      surface,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
  remember(orders, key, { at: now, cards }, CACHE_ENTRIES);
  return cards;
}

/** Each card's presentation (its chosen video frame and logo). Cards with none
 * remembered are read together, waiting at most PRESENTATION_DEADLINE_MS. Every
 * answer is remembered for a minute (a failed read as no presentation), even one
 * that comes after the deadline. One warning per visit counts the cards left
 * with their preview picture alone. */
async function cardPresentations(
  surface: ShowroomSurface,
  ids: readonly string[]
): Promise<Map<string, FoundationCardPresentation | undefined>> {
  const fresh = (id: string) => {
    const kept = presentations.get(id);
    return kept && Date.now() - kept.at < CACHE_MS ? kept : undefined;
  };
  const missing = ids.filter((id) => !fresh(id));
  if (missing.length > 0) {
    let failed = 0;
    let started = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const api = foundationServerPublicApi();
      const reads = missing.map((id) =>
        searchFoundationPresentedCards(api, { post_id: id, offset: 0, limit: 1 })
          .then(
            // A reply for another post is ignored.
            (page) => page.items.find((item) => item.id === id)?.presentation,
            () => {
              // Counted in the warning below; the card keeps its preview picture.
              failed += 1;
              return undefined;
            }
          )
          .then((presentation) =>
            remember(presentations, id, { at: Date.now(), presentation }, PRESENTATION_ENTRIES)
          )
      );
      started = true;
      await Promise.race([
        Promise.all(reads),
        new Promise((resolve) => {
          timer = setTimeout(resolve, PRESENTATION_DEADLINE_MS);
        }),
      ]);
    } catch {
      // The connection could not be set up, so nothing was read: the warning
      // below counts every missing card, and the next visit reads them again.
    } finally {
      clearTimeout(timer);
    }
    const unanswered = missing.filter((id) => !fresh(id)).length;
    if (failed + unanswered > 0)
      log.warn(
        "Showroom card presentations unavailable; those cards show their preview picture alone",
        {
          surface,
          cards: missing.length,
          failed: started ? failed : missing.length,
          late: started ? unanswered : 0,
        }
      );
  }
  return new Map(ids.map((id) => [id, fresh(id)?.presentation]));
}

/** The fair order's cards with their presentations, or null when the order
 * cannot be read. */
async function fairOrder(surface: ShowroomSurface, area: Area): Promise<CarouselItem[] | null> {
  const key = `${surface}|${area.province ?? ""}|${area.city ?? ""}`;
  const cards = await fairCards(surface, area, key);
  if (!cards) return null;
  const presented = await cardPresentations(
    surface,
    cards.map((card) => card.id)
  );
  return cards.map((card) => carouselItem(card, presented.get(card.id)));
}

/** Forgets every remembered order, presentation and read (unit tests only). */
export function resetShowroomCachesForTests() {
  orders.clear();
  presentations.clear();
  orderReads.clear();
}

/** The newest posts, as before the fair order (used only when it fails). */
async function newestFirst(surface: ShowroomSurface): Promise<CarouselItem[]> {
  const page = await searchFoundationPresentedCards(foundationServerPublicApi(), {
    limit: SHOWROOM_LIMITS[surface],
    ...(surface === "home" ? {} : { area: surface === "tourism" ? "tourism_events" : surface }),
  });
  return page.items.map((item) => carouselItem(item, item.presentation));
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
  // Visual pictures must be stable: the browser test copy keeps the front card.
  if (fair) return rotateFront(fair, process.env.PLAYWRIGHT_TEST_MODE === "1" ? () => 0 : random);
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
