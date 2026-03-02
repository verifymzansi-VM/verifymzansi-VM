import { Skeleton } from "@/components/ui/skeleton";

export default function BusinessAdLoading() {
  return (
    <div className="container-page py-6 space-y-6">
      {/* Hero skeleton */}
      <Skeleton className="h-64 w-full rounded-2xl" />

      {/* Business info */}
      <div className="flex items-center gap-4">
        <Skeleton className="h-16 w-16 rounded-xl" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-36" />
        </div>
      </div>

      {/* Details skeleton */}
      <div className="space-y-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-12 w-40 rounded-lg" />
      </div>
    </div>
  );
}
