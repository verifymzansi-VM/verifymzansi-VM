import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Loading skeleton for ShowroomCardCarousel – rendered while hero data streams in via Suspense.
 * Matches the showroom card footprint and section height so content does not shift on load.
 */
export function ShowroomCardCarouselSkeleton() {
  return (
    <section className="relative w-full overflow-hidden bg-[linear-gradient(180deg,#faf8f3_0%,#f3eee4_52%,#ece5d6_100%)] pt-0 pb-8 dark:bg-[linear-gradient(180deg,#0c0f14_0%,#0a0d12_52%,#080a0f_100%)] sm:pt-0 sm:pb-10 md:pt-4 md:pb-12 lg:min-h-[clamp(31rem,64vh,42rem)] lg:py-10">
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(250,246,239,0.22)_0%,rgba(241,232,218,0.08)_42%,rgba(15,23,42,0.14)_100%)] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.02)_0%,rgba(0,0,0,0.1)_42%,rgba(0,0,0,0.24)_100%)]"
        aria-hidden="true"
      />
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

      {/* Dot indicators skeleton */}
      <div className="absolute inset-x-0 bottom-2 z-20 flex items-center justify-center gap-1 lg:bottom-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className={cn("rounded-full", i === 2 ? "h-1.5 w-6" : "h-1.5 w-1.5")} />
        ))}
      </div>
    </section>
  );
}

function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[28px] border border-black/5 bg-white shadow-[0_28px_90px_-56px_rgba(15,23,42,0.4)] dark:border-white/10 dark:bg-slate-950">
      {/* 9:16 thumbnail placeholder */}
      <Skeleton className="aspect-[9/16] w-full rounded-none" />
      {/* Metadata row */}
      <div className="flex gap-3 px-3.5 py-3">
        <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
        <div className="flex-1 space-y-1.5 pt-0.5">
          <Skeleton className="h-3 w-3/4 rounded" />
          <Skeleton className="h-2.5 w-1/2 rounded" />
        </div>
      </div>
    </div>
  );
}
