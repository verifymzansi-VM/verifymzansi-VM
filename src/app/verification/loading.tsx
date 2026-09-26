import { Skeleton } from "@/components/ui/skeleton";

export default function VerificationLoading() {
  return (
    <div
      className="container-page py-5 sm:py-8"
      aria-busy="true"
      aria-label="Loading verification status"
    >
      <div className="mx-auto w-full max-w-5xl space-y-5">
        <div className="hero-panel space-y-4 p-5 sm:p-7">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-4 w-full max-w-md" />
          <div className="grid grid-cols-5 gap-2 pt-2">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="flex flex-col items-center gap-2">
                <Skeleton className="h-9 w-9 rounded-full" />
                <Skeleton className="h-3 w-12" />
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
          <div className="surface-card space-y-4 p-5 sm:p-6">
            <div className="flex items-center gap-4">
              <Skeleton className="h-12 w-12 rounded-2xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-48" />
              </div>
            </div>
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
          <div className="surface-card hidden space-y-3 p-5 lg:block">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
