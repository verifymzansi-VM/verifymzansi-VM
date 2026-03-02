import { Skeleton } from "@/components/ui/skeleton";

export default function VerificationLoading() {
  return (
    <div className="container-page py-8 space-y-6 max-w-2xl mx-auto">
      <div className="text-center space-y-2">
        <Skeleton className="h-10 w-10 rounded-full mx-auto" />
        <Skeleton className="h-7 w-48 mx-auto" />
        <Skeleton className="h-4 w-72 mx-auto" />
      </div>

      {/* Progress steps skeleton */}
      <div className="flex items-center justify-center gap-2 py-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded-full" />
            {i < 3 && <Skeleton className="h-1 w-12" />}
          </div>
        ))}
      </div>

      {/* Step content skeleton */}
      <div className="rounded-xl border border-warm-200 dark:border-warm-700 p-6 space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <div className="space-y-2 pt-4">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
    </div>
  );
}
