import { ShowroomHero, type ShowroomSlide } from "./showroom-hero";
import { SHOWROOM_LAYOUT_CLASSES } from "./showroom-layout-classes";
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
      <div className={SHOWROOM_LAYOUT_CLASSES.container}>
        {/* Left side card — hidden below lg */}
        <div className={SHOWROOM_LAYOUT_CLASSES.side}>
          <div className="h-full">
            <ShowroomSideCard items={leftItems} initialDelayMs={0} />
          </div>
        </div>

        {/* Center showroom — single instance, always rendered */}
        <div className={SHOWROOM_LAYOUT_CLASSES.center}>{showroomNode}</div>

        {/* Right side card — hidden below lg */}
        <div className={SHOWROOM_LAYOUT_CLASSES.side}>
          <div className="h-full">
            <ShowroomSideCard items={rightItems} initialDelayMs={2500} />
          </div>
        </div>
      </div>
    </section>
  );
}
