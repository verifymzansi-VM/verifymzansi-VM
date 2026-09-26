/**
 * Placeholder for one homepage showcase (HomeShowcaseShell): kicker, title,
 * lede and "See all" link above a rail of preview cards. Each showcase has its
 * own Suspense boundary, so this renders a single section by default.
 */
export function MarketplacePreviewsSkeleton({ sections = 1 }: { sections?: number }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: sections }).map((_, sectionIdx) => (
        <div key={sectionIdx} className="py-8 sm:py-10" aria-hidden="true">
          <div className="container-page">
            <div className="mb-5 flex items-end justify-between gap-4 sm:mb-6">
              <div className="min-w-0 flex-1 space-y-2.5">
                <div className="skeleton-shimmer h-4 w-32 rounded-full" />
                <div className="skeleton-shimmer h-7 w-3/4 max-w-sm rounded-lg sm:h-8" />
                <div className="skeleton-shimmer h-4 w-full max-w-md rounded-full" />
              </div>
              <div className="skeleton-shimmer h-9 w-20 shrink-0 rounded-full" />
            </div>

            <div className="flex gap-3 overflow-hidden sm:gap-4">
              {Array.from({ length: 5 }).map((_, cardIdx) => (
                <div key={cardIdx} className="w-[44%] shrink-0 space-y-2 sm:w-[280px] lg:w-[240px]">
                  <div className="skeleton-shimmer aspect-square w-full rounded-xl" />
                  <div className="skeleton-shimmer h-3.5 w-1/3 rounded-full" />
                  <div className="skeleton-shimmer h-3.5 w-4/5 rounded-full" />
                  <div className="skeleton-shimmer h-3 w-1/2 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
