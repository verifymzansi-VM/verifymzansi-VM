export function MarketplacePreviewsSkeleton() {
  return (
    <div className="space-y-6">
      {Array.from({ length: 3 }).map((_, sectionIdx) => (
        <div key={sectionIdx} className="space-y-4">
          <div className="flex items-baseline justify-between">
            <div className="space-y-1.5">
              <div className="h-5 w-32 animate-pulse rounded bg-warm-200 dark:bg-warm-700" />
              <div className="h-3 w-16 animate-pulse rounded bg-warm-200 dark:bg-warm-700" />
            </div>
            <div className="h-4 w-16 animate-pulse rounded bg-warm-200 dark:bg-warm-700" />
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, cardIdx) => (
              <div key={cardIdx} className="space-y-2">
                <div className="aspect-[9/16] animate-pulse rounded-[20px] bg-warm-200 dark:bg-warm-700" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
