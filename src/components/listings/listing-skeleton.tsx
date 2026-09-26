import { cn } from "@/lib/utils";

/**
 * Mirrors the immersive PosterCardShell used by the browse grids: a 4:5 media
 * frame with price, title, location and trust line underneath.
 */
export function ListingCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("min-w-0", className)} aria-hidden="true">
      <div className="skeleton-shimmer aspect-[4/5] w-full rounded-2xl" />
      <div className="space-y-2 px-0.5 pt-2.5">
        <div className="skeleton-shimmer h-4 w-2/5 rounded-full" />
        <div className="skeleton-shimmer h-3.5 w-11/12 rounded-full" />
        <div className="skeleton-shimmer h-3 w-1/2 rounded-full" />
        <div className="skeleton-shimmer h-3 w-1/3 rounded-full" />
      </div>
    </div>
  );
}

export function ListingGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-5 xl:gap-6"
      role="status"
      aria-busy="true"
      aria-label="Loading results"
    >
      {Array.from({ length: count }).map((_, i) => (
        <ListingCardSkeleton key={i} />
      ))}
    </div>
  );
}
