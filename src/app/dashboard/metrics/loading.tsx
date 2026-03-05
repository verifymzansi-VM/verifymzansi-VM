import { Skeleton } from "@/components/ui/skeleton";

export default function MetricsLoading() {
  return (
    <div className="space-y-4 p-6" aria-busy="true" aria-label="Loading">
      {/* Page header */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-56" />
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-warm-200 dark:border-warm-700 p-4 space-y-3"
          >
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>

      {/* Chart placeholder */}
      <div className="rounded-xl border border-warm-200 dark:border-warm-700 p-5 space-y-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    </div>
  );
}
