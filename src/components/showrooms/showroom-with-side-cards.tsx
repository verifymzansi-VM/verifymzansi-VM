import { ShowroomHero, type ShowroomSlide } from "./showroom-hero";
import { ShowroomSideCard, type SideCardItem } from "./showroom-side-card";

interface ShowroomWithSideCardsProps {
  slides: ShowroomSlide[];
  fallbackTitle?: string;
  fallbackDescription?: string;
  fallbackMedia?: string;
  /** Promotion/event cover images for the desktop side cards */
  sideCardItems?: SideCardItem[];
}

export function ShowroomWithSideCards({
  slides,
  fallbackTitle,
  fallbackDescription,
  fallbackMedia,
  sideCardItems = [],
}: ShowroomWithSideCardsProps) {
  const hasEnoughItems = sideCardItems.length >= 1;

  // Both sides show the same items (staggered by initialDelayMs)
  const leftItems = sideCardItems;
  const rightItems = sideCardItems;

  const showroomNode = (
    <ShowroomHero
      slides={slides}
      fallbackTitle={fallbackTitle}
      fallbackDescription={fallbackDescription}
      fallbackMedia={fallbackMedia}
    />
  );

  if (!hasEnoughItems) {
    return <section className="w-full">{showroomNode}</section>;
  }

  return (
    <section className="w-full">
      {/* Single flex container: side cards hidden on mobile, shown on desktop */}
      <div className="lg:flex lg:items-center lg:gap-2 lg:px-2 lg:max-h-[480px] xl:gap-3 xl:px-3">
        {/* Left side card — hidden below lg */}
        <div className="hidden w-[15%] shrink-0 lg:block">
          <div className="aspect-[1/2] max-h-full w-full">
            <ShowroomSideCard items={leftItems} initialDelayMs={0} />
          </div>
        </div>

        {/* Center showroom — single instance, always rendered */}
        <div className="min-w-0 lg:flex-1">{showroomNode}</div>

        {/* Right side card — hidden below lg */}
        <div className="hidden w-[15%] shrink-0 lg:block">
          <div className="aspect-[1/2] max-h-full w-full">
            <ShowroomSideCard items={rightItems} initialDelayMs={3000} />
          </div>
        </div>
      </div>
    </section>
  );
}
