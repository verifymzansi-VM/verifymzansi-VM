import { Suspense } from "react";
import { ShowroomCardCarousel, type CarouselItem } from "./showroom-card-carousel";
import { ShowroomCardCarouselSkeleton } from "./showroom-card-carousel-skeleton";
import {
  preloadShowroomBackground,
  type ShowroomDecorativeBackground,
} from "./showroom-section-shell";
import { loadShowroomItems, type ShowroomClient, type ShowroomSurface } from "@/lib/showroom/feed";
import { getVisitorProvince } from "@/lib/showroom/visitor-province";
import { createClient } from "@/lib/supabase/server";

export interface StreamedShowroomProps {
  feed: Exclude<ShowroomSurface, "home">;
  /** View-reporting surface passed to the carousel, e.g. "showroom:market". */
  surface: string;
  background: ShowroomDecorativeBackground;
  hideFixtures: boolean;
  emptyTitle: string;
  emptyDescription: string;
  emptyMediaUrl?: string;
  /** Shown as the only card when the feed has no posts. */
  emptyItem?: CarouselItem;
}

/**
 * An area showroom that paints its artwork (the LCP element) with the page
 * shell, then streams the cards in once the fair-rotation feed has loaded.
 */
export function StreamedShowroom(props: StreamedShowroomProps) {
  preloadShowroomBackground(props.background);

  return (
    <Suspense fallback={<ShowroomCardCarouselSkeleton background={props.background} />}>
      <ShowroomWithData {...props} />
    </Suspense>
  );
}

export async function ShowroomWithData({
  feed,
  surface,
  background,
  hideFixtures,
  emptyTitle,
  emptyDescription,
  emptyMediaUrl,
  emptyItem,
}: StreamedShowroomProps) {
  const visitor = await getVisitorProvince();
  const supabase = await createClient();
  const items = await loadShowroomItems(feed, {
    province: visitor.province,
    hideFixtures,
    client: supabase as unknown as ShowroomClient,
  });

  return (
    <ShowroomCardCarousel
      items={items.length === 0 && emptyItem ? [emptyItem] : items}
      surface={surface}
      visitorProvince={visitor}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
      emptyMediaUrl={emptyMediaUrl}
      background={background}
    />
  );
}
