import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton shown while the HeroBanner data streams in via Suspense. */
export function HeroBannerSkeleton() {
  return (
    <section className="relative w-full overflow-hidden bg-warm-950">
      {/* Slide area */}
      <div className="relative aspect-[16/9] sm:aspect-[21/9] md:aspect-[3/1]">
        <Skeleton className="absolute inset-0 rounded-none" />
      </div>

      {/* Search bar skeleton */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-full max-w-lg px-4">
        <Skeleton className="h-12 w-full rounded-full" />
      </div>
    </section>
  );
}
