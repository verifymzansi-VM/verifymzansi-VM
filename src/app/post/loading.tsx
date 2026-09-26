import { Skeleton } from "@/components/ui/skeleton";

export default function PostLoading() {
  return (
    <div
      className="container-page mx-auto max-w-3xl space-y-5 py-6"
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="space-y-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="surface-card overflow-hidden">
        <div className="space-y-3 border-b border-border/60 bg-muted/30 p-4">
          <Skeleton className="h-4 w-24" />
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-1.5 rounded-full" />
            ))}
          </div>
        </div>
        <div className="space-y-5 p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-xl" />
            <Skeleton className="h-6 w-32" />
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[4.5rem] rounded-2xl" />
            ))}
          </div>
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-11 w-full rounded-xl" />
            </div>
          ))}
        </div>
      </div>
      <Skeleton className="h-11 w-full rounded-full sm:ml-auto sm:w-32" />
    </div>
  );
}
