import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton shown while the HeroBanner data streams in via Suspense. */
export function HeroBannerSkeleton() {
  return (
    <section className="w-full overflow-hidden bg-warm-950">
      {/* Slide area */}
      <div className="relative aspect-[2/1] sm:aspect-[3/1] md:aspect-[3/1]">
        <Skeleton className="absolute inset-0 rounded-none" />
      </div>

      {/* Category strip skeleton */}
      <div className="border-b border-warm-800 bg-warm-900 px-4 py-3">
        <div className="mx-auto grid max-w-4xl grid-cols-3 gap-2 sm:gap-3">
          <Skeleton className="h-14 rounded-2xl" />
          <Skeleton className="h-14 rounded-2xl" />
          <Skeleton className="h-14 rounded-2xl" />
        </div>
      </div>
    </section>
  );
}
