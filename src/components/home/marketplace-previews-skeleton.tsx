/**
 * Placeholder for one homepage rail (HomeShowcaseShell): area icon, title,
 * summary and "View all" above a row of 9:16 cards. Each rail has its own
 * Suspense boundary, so this renders one section and announces loading once.
 */
export function MarketplacePreviewsSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="py-6 sm:py-8 lg:py-10">
      <div className="container-page" aria-hidden="true">
        <div className="mb-4 flex items-center justify-between gap-4 sm:mb-5">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="skeleton-shimmer h-10 w-10 rounded-full sm:h-12 sm:w-12" />
            <div className="space-y-1.5">
              <div className="skeleton-shimmer h-5 w-36 rounded-md sm:h-6 sm:w-48" />
              <div className="skeleton-shimmer h-3.5 w-28 rounded-md sm:w-40" />
            </div>
          </div>
          <div className="skeleton-shimmer h-5 w-16 rounded-md" />
        </div>
        <div className="flex gap-3 overflow-hidden sm:gap-4">
          {Array.from({ length: 5 }).map((_, cardIdx) => (
            <div
              key={cardIdx}
              className="skeleton-shimmer aspect-[9/16] w-[64%] shrink-0 rounded-[20px] sm:w-[238px]"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
