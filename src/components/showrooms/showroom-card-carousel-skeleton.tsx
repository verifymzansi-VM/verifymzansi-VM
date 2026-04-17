import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Loading skeleton for ShowroomCardCarousel – rendered while hero data streams in via Suspense.
 * Matches the showroom card footprint while data streams in.
 */
export function ShowroomCardCarouselSkeleton() {
  return (
    <section className="w-full bg-[linear-gradient(180deg,#f8f5ec_0%,#f1e8da_48%,#e8decd_100%)] pt-0 pb-1 sm:pt-0 sm:pb-3 lg:h-[calc(100svh-4rem)] lg:py-0">
      <div className="relative mx-auto flex items-center justify-center overflow-hidden px-4 lg:h-full">
        {/* Left card (scaled down) */}
        <div
          className="absolute left-[3%] sm:left-[8%] lg:left-[15%] w-[72vw] max-w-[292px] sm:w-[46vw] sm:max-w-[310px] lg:w-[292px] xl:w-[320px] origin-center scale-[0.82] opacity-50"
          aria-hidden="true"
        >
          <CardSkeleton />
        </div>

        {/* Center card (full size) */}
        <div className="z-10 w-[72vw] max-w-[292px] sm:w-[46vw] sm:max-w-[310px] lg:w-[292px] xl:w-[320px]">
          <CardSkeleton />
        </div>

        {/* Right card (scaled down) */}
        <div
          className="absolute right-[3%] sm:right-[8%] lg:right-[15%] w-[72vw] max-w-[292px] sm:w-[46vw] sm:max-w-[310px] lg:w-[292px] xl:w-[320px] origin-center scale-[0.82] opacity-50"
          aria-hidden="true"
        >
          <CardSkeleton />
        </div>
      </div>

      {/* Dot indicators skeleton */}
      <div className="absolute inset-x-0 bottom-2 flex items-center justify-center gap-1.5 lg:bottom-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton
            key={i}
            className={cn(
              "rounded-full",
              i === 2
                ? "h-1.5 w-5 sm:h-2 sm:w-6 bg-warm-700"
                : "h-1.5 w-1.5 sm:h-2 sm:w-2 bg-warm-800"
            )}
          />
        ))}
      </div>
    </section>
  );
}

function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[28px] border border-black/5 bg-white shadow-[0_28px_90px_-56px_rgba(15,23,42,0.4)]">
      {/* 9:16 thumbnail placeholder */}
      <Skeleton className="aspect-[9/16] w-full rounded-none bg-stone-200" />
      {/* Metadata row */}
      <div className="flex gap-3 px-3.5 py-3">
        <Skeleton className="h-8 w-8 shrink-0 rounded-full bg-stone-200" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3 w-3/4 rounded bg-stone-200" />
          <Skeleton className="h-2.5 w-1/2 rounded bg-stone-200" />
        </div>
      </div>
    </div>
  );
}
