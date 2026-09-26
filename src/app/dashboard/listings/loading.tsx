import { Skeleton } from "@/components/ui/skeleton";

export default function ListingsLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading your posts">
      {/* Page header */}
      <div className="space-y-4">
        <Skeleton className="h-4 w-40" />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-11 w-full rounded-full sm:w-32" />
        </div>
      </div>

      {/* Area filter + status tabs */}
      <div className="space-y-4">
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-28 shrink-0 rounded-full" />
          ))}
        </div>
        <Skeleton className="h-12 w-full max-w-md rounded-2xl" />
      </div>

      {/* Post cards */}
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border/70 bg-card p-4 sm:p-5">
            <div className="flex items-start gap-3 sm:gap-4">
              <Skeleton className="h-16 w-16 shrink-0 rounded-xl sm:h-[4.5rem] sm:w-[4.5rem]" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-3/5" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-2/5" />
              </div>
            </div>
            <div className="mt-3 flex gap-2 border-t border-border/60 pt-3">
              <Skeleton className="h-11 w-20 rounded-xl" />
              <Skeleton className="h-11 w-20 rounded-xl" />
              <Skeleton className="ml-auto h-11 w-32 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
