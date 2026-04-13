import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Loading skeleton for ShowroomCardCarousel – rendered while hero data streams in via Suspense.
 * Matches the dark background and coverflow card layout of the real carousel.
 */
export function ShowroomCardCarouselSkeleton() {
  return (
    <section className="w-full bg-gradient-to-b from-warm-950 via-warm-900 to-warm-950 py-6 sm:py-8 lg:py-10 dark:from-black dark:via-warm-950 dark:to-black">
      <div className="relative mx-auto flex items-center justify-center overflow-hidden px-4">
        {/* Left card (scaled down) */}
        <div
          className="absolute left-[5%] sm:left-[10%] lg:left-[15%] w-[52vw] sm:w-[40vw] lg:w-[252px] xl:w-[288px] origin-center scale-[0.82] opacity-50"
          aria-hidden="true"
        >
          <CardSkeleton />
        </div>

        {/* Center card (full size) */}
        <div className="w-[52vw] sm:w-[40vw] lg:w-[252px] xl:w-[288px] z-10">
          <CardSkeleton />
        </div>

        {/* Right card (scaled down) */}
        <div
          className="absolute right-[5%] sm:right-[10%] lg:right-[15%] w-[52vw] sm:w-[40vw] lg:w-[252px] xl:w-[288px] origin-center scale-[0.82] opacity-50"
          aria-hidden="true"
        >
          <CardSkeleton />
        </div>
      </div>

      {/* Dot indicators skeleton */}
      <div className="mt-4 flex items-center justify-center gap-1.5">
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
    <div className="overflow-hidden rounded-xl bg-warm-900">
      {/* 9:16 thumbnail placeholder */}
      <Skeleton className="aspect-[9/16] w-full rounded-none bg-warm-800" />
      {/* Metadata row */}
      <div className="flex gap-2 p-2.5">
        <Skeleton className="h-7 w-7 shrink-0 rounded-full bg-warm-800" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3 w-3/4 rounded bg-warm-800" />
          <Skeleton className="h-2.5 w-1/2 rounded bg-warm-800" />
        </div>
      </div>
    </div>
  );
}
