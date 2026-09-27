import { Skeleton } from "@/components/ui/skeleton";

export default function MarketplaceLoading() {
  return (
    <div className="space-y-0" aria-busy="true" aria-label="Loading">
      {/* Showroom hero skeleton — full width */}
      <div className="relative w-full aspect-[21/9] md:aspect-[3/1] bg-warm-100 dark:bg-warm-900">
        <div className="absolute inset-0 flex items-end p-6 md:p-10">
          <div className="space-y-3 w-full max-w-lg">
            <Skeleton className="h-4 w-24 rounded-full" />
            <Skeleton className="h-7 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-9 w-32 rounded-lg" />
          </div>
        </div>
      </div>

      {/* Trust strip skeleton */}
      <div className="h-8 bg-warm-50 dark:bg-warm-900 border-y border-warm-200 dark:border-warm-800" />

      {/* Main content area */}
      <div className="container-page py-6 space-y-4">
        {/* Page header skeleton */}
        <div className="space-y-1">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>

        {/* Category strip skeleton */}
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-24 rounded-full shrink-0" />
          ))}
        </div>

        {/* Grid skeleton */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5 xl:gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-warm-200 dark:border-warm-700 p-3 space-y-3"
            >
              <Skeleton className="h-44 w-full rounded-lg" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <div className="flex justify-between items-center pt-1">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-4 w-16" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
