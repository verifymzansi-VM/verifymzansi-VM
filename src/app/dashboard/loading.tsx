import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      {/* Page header skeleton */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
        <div className="space-y-6">
          <div className="rounded-xl border border-warm-200 dark:border-warm-700 p-5 space-y-4">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-4 w-full max-w-md" />
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-warm-200 dark:border-warm-700 p-4 space-y-3"
                >
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <Skeleton className="h-8 w-14" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-full max-w-[220px]" />
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border border-warm-200 dark:border-warm-700 p-5 space-y-3"
              >
                <Skeleton className="h-10 w-10 rounded-xl" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-9 w-16" />
                <Skeleton className="h-4 w-full max-w-[220px]" />
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-warm-200 dark:border-warm-700 p-5 space-y-4">
            <Skeleton className="h-6 w-52" />
            <Skeleton className="h-4 w-full max-w-md" />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-warm-200 dark:border-warm-700 p-5 space-y-4">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-full max-w-sm" />
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-10 w-40" />
          </div>
          <div className="rounded-xl border border-warm-200 dark:border-warm-700 p-5 space-y-4">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-full max-w-sm" />
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
