import { Skeleton } from "@/components/ui/skeleton";

export default function VerificationLoading() {
  return (
    <div
      className="container-page mx-auto max-w-4xl space-y-6 py-6"
      aria-busy="true"
      aria-label="Loading verification status"
    >
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>

      <div className="rounded-xl border border-warm-200 bg-background/95 p-5 dark:border-warm-700">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-full max-w-sm" />
          </div>
        </div>
      </div>
    </div>
  );
}
