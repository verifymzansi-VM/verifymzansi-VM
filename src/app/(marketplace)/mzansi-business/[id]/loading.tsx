import { Skeleton } from "@/components/ui/skeleton";

export default function BusinessDetailLoading() {
  return (
    <div className="container-page py-4 space-y-5" aria-busy="true" aria-label="Loading">
      {/* Cover image skeleton */}
      <div className="relative rounded-2xl overflow-hidden bg-muted">
        <Skeleton className="aspect-[21/9] md:aspect-[4/1] w-full" />
      </div>

      {/* Profile area */}
      <div className="flex items-end gap-4 -mt-10 relative z-10 px-4">
        <Skeleton className="h-20 w-20 rounded-2xl border-4 border-background" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-4">
          <Skeleton className="h-5 w-3/4" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>

          {/* Gallery placeholder */}
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-lg" />
            ))}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="rounded-xl border border-warm-200 dark:border-warm-700 p-4 space-y-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
          <div className="rounded-xl border border-warm-200 dark:border-warm-700 p-4 space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      </div>
    </div>
  );
}
