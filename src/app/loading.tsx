import { Bone, HeaderSkeleton, LoadingRegion } from "@/components/shared/page-skeletons";
import { ListingCardSkeleton } from "@/components/listings/listing-skeleton";

/** Shared by every route while its own content is still streaming. */
export default function GlobalLoading() {
  return (
    <LoadingRegion className="min-h-screen bg-background">
      <HeaderSkeleton />
      <main id="main-content" className="container-page space-y-8 py-6 sm:py-9">
        <div className="space-y-3">
          <Bone className="h-9 w-2/3 max-w-md rounded-lg sm:h-11" />
          <Bone className="h-4 w-full max-w-xl rounded-full" />
          <Bone className="h-4 w-1/2 max-w-sm rounded-full" />
        </div>
        <div className="flex gap-2 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <Bone key={i} className="h-9 w-28 shrink-0 rounded-full" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <ListingCardSkeleton key={i} />
          ))}
        </div>
      </main>
    </LoadingRegion>
  );
}
