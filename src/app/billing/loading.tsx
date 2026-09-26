import { Skeleton } from "@/components/ui/skeleton";

/** Shaped like the billing page: header, free-post banner, plan picker and four plan cards. */
export default function BillingLoading() {
  return (
    <div className="container-page space-y-8 py-8" aria-busy="true" aria-label="Loading billing">
      <div className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-4 w-full max-w-lg" />
      </div>

      <Skeleton className="mx-auto h-20 w-full max-w-5xl rounded-2xl" />

      <div className="flex flex-col items-center gap-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-12 w-full max-w-lg rounded-full" />
      </div>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-4 rounded-3xl border border-border/70 bg-card p-6">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-10 w-28" />
            <div className="space-y-2.5 border-t border-border/60 pt-5">
              {Array.from({ length: 4 }).map((_, j) => (
                <Skeleton key={j} className="h-4 w-full" />
              ))}
            </div>
            <Skeleton className="h-11 w-full rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
