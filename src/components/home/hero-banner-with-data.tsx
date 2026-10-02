import { ShowroomCardCarousel } from "@/components/showrooms/showroom-card-carousel";
import { generatedMzansiShowroomBackground } from "@/components/showrooms/showroom-backgrounds";
import { loadShowroomItems } from "@/lib/showroom/feed";
import { getVisitorProvince } from "@/lib/showroom/visitor-province";

/**
 * Async server component that fetches the home showroom in fair rotation
 * order (local posts first) and renders the carousel. Designed to be wrapped
 * in <Suspense> so the rest of the homepage streams immediately.
 */
export async function HeroBannerWithData() {
  const visitor = await getVisitorProvince();
  const carouselItems = await loadShowroomItems("home", { province: visitor.province });

  return (
    <ShowroomCardCarousel
      items={carouselItems}
      surface="showroom:home"
      visitorProvince={visitor}
      emptyTitle="Welcome to VerifyMzansi"
      emptyDescription="Explore business profiles, listings, tourism, and events across South Africa."
      emptyMediaUrl="/images/fallbacks/hero-home.svg"
      background={generatedMzansiShowroomBackground}
      className="showroom-fill"
    />
  );
}
