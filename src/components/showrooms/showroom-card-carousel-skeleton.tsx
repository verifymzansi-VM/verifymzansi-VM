import { ShowroomSectionShell, type ShowroomDecorativeBackground } from "./showroom-section-shell";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading skeleton for ShowroomCardCarousel – rendered while hero data streams in via Suspense.
 * Matches the showroom card footprint and section height so content does not shift on load.
 */
export function ShowroomCardCarouselSkeleton({
  background,
}: {
  background?: ShowroomDecorativeBackground;
}) {
  return (
    <ShowroomSectionShell sectionClassName="showroom-viewport" background={background}>
      <div className="relative z-10 mx-auto flex items-center justify-center overflow-hidden px-4 lg:h-full">
        {/* Left card (scaled down) */}
        <div
          className="showroom-card-frame absolute left-[3%] origin-center scale-[0.82] sm:left-[8%] lg:left-[15%]"
          aria-hidden="true"
        >
          <CardSkeleton />
        </div>

        {/* Center card (full size) */}
        <div className="showroom-card-frame z-10">
          <CardSkeleton />
        </div>

        {/* Right card (scaled down) */}
        <div
          className="showroom-card-frame absolute right-[3%] origin-center scale-[0.82] sm:right-[8%] lg:right-[15%]"
          aria-hidden="true"
        >
          <CardSkeleton />
        </div>
      </div>
    </ShowroomSectionShell>
  );
}

function CardSkeleton() {
  return (
    <div
      data-card-variant="hero"
      className="overflow-hidden rounded-[28px] border border-black/5 bg-white shadow-[0_28px_90px_-56px_rgba(15,23,42,0.4)] dark:border-white/10 dark:bg-slate-950"
    >
      {/* 9:16 thumbnail placeholder */}
      <Skeleton data-card-media className="aspect-[9/16] w-full rounded-none" />
      {/* Metadata row */}
      <div data-card-metadata className="flex h-16 gap-3 px-3.5 py-3">
        <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
        <div className="flex-1 space-y-1.5 pt-0.5">
          <Skeleton className="h-3 w-3/4 rounded" />
          <Skeleton className="h-2.5 w-1/2 rounded" />
        </div>
      </div>
    </div>
  );
}
