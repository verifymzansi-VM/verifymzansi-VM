export function MarketplacePreviewsSkeleton() {
  return (
    <div className="space-y-8">
      {Array.from({ length: 3 }).map((_, sectionIdx) => (
        <div key={sectionIdx} className="space-y-4">
          {/* Section header skeleton */}
          <div className="flex items-baseline justify-between">
            <div className="space-y-1.5">
              <div className="h-5 w-32 rounded bg-warm-200 dark:bg-warm-700 animate-pulse" />
              <div className="h-3 w-16 rounded bg-warm-200 dark:bg-warm-700 animate-pulse" />
            </div>
            <div className="h-4 w-16 rounded bg-warm-200 dark:bg-warm-700 animate-pulse" />
          </div>

          {/* Card grid skeleton */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, cardIdx) => (
              <div key={cardIdx} className="space-y-2">
                {/* Thumbnail */}
                <div className="aspect-[4/3] rounded-lg bg-warm-200 dark:bg-warm-700 animate-pulse" />
                {/* Title */}
                <div className="h-4 w-3/4 rounded bg-warm-200 dark:bg-warm-700 animate-pulse" />
                {/* Location */}
                <div className="h-3 w-1/2 rounded bg-warm-200 dark:bg-warm-700 animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
