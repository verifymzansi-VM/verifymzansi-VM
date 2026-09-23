import { Skeleton } from "@/components/ui/skeleton";

/** Shared by every route while its own content is still streaming. */
export default function GlobalLoading() {
  return (
    <div className="min-h-screen bg-background" aria-busy="true" aria-label="Loading">
      <main className="container-page space-y-6 py-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-40 rounded-lg" />
          <Skeleton className="h-9 w-9 rounded-full" />
        </div>
        <Skeleton className="h-56 w-full rounded-3xl sm:h-72" />
        <div className="space-y-3">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </main>
    </div>
  );
}
