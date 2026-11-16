import "server-only";
import { foundationServerPublicApi } from "@/lib/foundation/server-public";
import { searchFoundationCards, foundationMediaUrl } from "@/lib/foundation/public-cards";
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

/**
 * Showroom cards for a page, from the foundation's public post cards.
 * Never throws: on any failure the showroom shows no cards.
 */
export async function loadShowroomItems(surface: ShowroomSurface): Promise<CarouselItem[]> {
  try {
    const page = await searchFoundationCards(foundationServerPublicApi(), {
      limit: SHOWROOM_LIMITS[surface],
      ...(surface === "home" ? {} : { area: surface === "tourism" ? "tourism_events" : surface }),
    });
    return page.items.map((post) => ({
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
    }));
  } catch (error) {
    log.warn("Showroom feed unavailable", {
      surface,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return [];
  }
}
