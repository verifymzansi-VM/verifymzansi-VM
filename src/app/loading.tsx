import { Skeleton } from "@/components/ui/skeleton";

/** Shared by every route while its own content is still streaming. */
export default function GlobalLoading() {
  return (
    <div className="min-h-screen">
      <span className="sr-only" role="status">
        Loading
      </span>
      <main className="container-page space-y-6 py-6">
        <div className="flex items-center justify-between">
          <Skeleton aria-hidden className="h-9 w-40 rounded-lg" />
          <Skeleton aria-hidden className="h-9 w-9 rounded-full" />
        </div>
        <Skeleton aria-hidden className="h-56 w-full rounded-3xl sm:h-72" />
        <div className="space-y-3">
          <Skeleton aria-hidden className="h-7 w-52" />
          <Skeleton aria-hidden className="h-4 w-3/4" />
          <Skeleton aria-hidden className="h-4 w-1/2" />
        </div>
      </main>
    </div>
  );
}
