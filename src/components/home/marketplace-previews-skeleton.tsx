/**
 * Placeholder for one homepage rail (HomeShowcaseShell): area icon, title and
 * "View all" above a row of 9:16 cards. Each rail has its own Suspense
 * boundary, so this renders one section and announces loading once.
 */
export function MarketplacePreviewsSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="py-8 sm:py-10 lg:py-12">
      <div className="container-page" aria-hidden="true">
        <div className="rounded-3xl border border-border/60 bg-card px-2 py-5 elev-sm sm:px-8 sm:py-7 lg:px-10 lg:py-8">
          <div className="mb-5 flex items-center justify-between gap-3 px-2 sm:px-0">
            <div className="flex items-center gap-3">
              <div className="skeleton-shimmer h-10 w-10 rounded-xl sm:h-11 sm:w-11" />
              <div className="skeleton-shimmer h-7 w-40 rounded-lg sm:h-8 sm:w-56" />
            </div>
            <div className="skeleton-shimmer h-11 w-24 rounded-full" />
          </div>
          <div className="flex gap-3 overflow-hidden sm:gap-4">
            {Array.from({ length: 5 }).map((_, cardIdx) => (
              <div
                key={cardIdx}
                className="skeleton-shimmer aspect-[9/16] w-[44%] shrink-0 rounded-[20px] sm:w-[238px]"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
