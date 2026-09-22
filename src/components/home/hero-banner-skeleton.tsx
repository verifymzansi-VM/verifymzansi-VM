import { ShowroomCardCarouselSkeleton } from "@/components/showrooms/showroom-card-carousel-skeleton";

import { generatedMzansiShowroomBackground } from "@/components/showrooms/showroom-backgrounds";

/** Skeleton shown while the HeroBanner data streams in via Suspense. */
export function HeroBannerSkeleton() {
  return <ShowroomCardCarouselSkeleton background={generatedMzansiShowroomBackground} />;
}
