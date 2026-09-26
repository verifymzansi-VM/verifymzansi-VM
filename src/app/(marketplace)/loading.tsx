import { Bone, LoadingRegion } from "@/components/shared/page-skeletons";
import { ListingCardSkeleton } from "@/components/listings/listing-skeleton";

/** Browse pages: area intro, showroom band, then filters beside the results grid. */
export default function MarketplaceLoading() {
  return (
    <LoadingRegion>
      {/* AreaHero */}
      <div className="border-b border-border/60">
        <div className="container-page py-6 sm:py-9">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <Bone className="hidden h-14 w-14 shrink-0 rounded-2xl sm:block" />
              <div className="min-w-0 flex-1 space-y-2.5">
                <Bone className="h-8 w-56 rounded-lg sm:h-10 sm:w-72" />
                <Bone className="h-4 w-full max-w-md rounded-full" />
                <Bone className="h-4 w-56 rounded-full" />
              </div>
            </div>
            <Bone className="h-11 w-full shrink-0 rounded-full sm:w-40" />
          </div>
          <div className="mt-5 flex gap-2 overflow-hidden">
            {Array.from({ length: 7 }).map((_, i) => (
              <Bone key={i} className="h-9 w-28 shrink-0 rounded-full" />
            ))}
          </div>
        </div>
      </div>

      {/* Showroom band */}
      <div className="flex h-[420px] items-center justify-center gap-4 overflow-hidden bg-muted/50 sm:h-[480px]">
        <Bone className="hidden h-[70%] w-44 rounded-[28px] opacity-60 sm:block" />
        <Bone className="h-[88%] w-60 rounded-[28px] lg:w-72" />
        <Bone className="hidden h-[70%] w-44 rounded-[28px] opacity-60 sm:block" />
      </div>

      {/* Filters + grid */}
      <div className="container-page grid gap-6 py-8 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="surface-card hidden space-y-4 p-4 lg:block">
          <Bone className="h-5 w-32 rounded-full" />
          <Bone className="h-10 w-full rounded-xl" />
          <Bone className="h-4 w-20 rounded-full" />
          <Bone className="h-10 w-full rounded-xl" />
          <Bone className="h-4 w-20 rounded-full" />
          <Bone className="h-10 w-full rounded-xl" />
        </div>
        <div className="space-y-5">
          <div className="space-y-2">
            <Bone className="h-7 w-48 rounded-lg" />
            <Bone className="h-4 w-64 rounded-full" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <ListingCardSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    </LoadingRegion>
  );
}
