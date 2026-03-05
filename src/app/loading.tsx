import { Skeleton } from "@/components/ui/skeleton";

export default function HomeLoading() {
  return (
    <div className="flex min-h-screen flex-col" aria-busy="true" aria-label="Loading">
      {/* Header placeholder */}
      <div className="h-16 border-b border-warm-200 dark:border-warm-800" />

      <main className="flex-1">
        {/* Hero banner skeleton */}
        <div className="relative w-full aspect-[21/9] md:aspect-[3/1] bg-warm-100 dark:bg-warm-900">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center space-y-4 max-w-xl px-4">
              <Skeleton className="h-8 w-64 mx-auto" />
              <Skeleton className="h-4 w-80 mx-auto" />
              <Skeleton className="h-10 w-full max-w-md mx-auto rounded-full" />
            </div>
          </div>
        </div>

        {/* Browse by Category skeleton */}
        <section className="py-5 sm:py-8 border-b border-warm-200 dark:border-warm-800 bg-white dark:bg-warm-950">
          <div className="container-page">
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex flex-col items-center gap-2 p-3">
                  <Skeleton className="w-10 h-10 sm:w-12 sm:h-12 rounded-full" />
                  <Skeleton className="h-3 w-14" />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Marketplace showcase skeleton */}
        <section className="py-6 sm:py-8">
          <div className="container-page space-y-4">
            <Skeleton className="h-6 w-48" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-warm-200 dark:border-warm-700 p-3 space-y-3"
                >
                  <Skeleton className="h-40 w-full rounded-lg" />
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
