import { Bone, LoadingRegion } from "@/components/shared/page-skeletons";
import { ListingCardSkeleton } from "@/components/listings/listing-skeleton";

export default function EventsLoading() {
  return (
    <LoadingRegion label="Loading events" className="container-page space-y-6 py-6 sm:py-9">
      <div className="space-y-2.5">
        <Bone className="h-8 w-40 rounded-lg sm:h-10" />
        <Bone className="h-4 w-full max-w-md rounded-full" />
      </div>
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <Bone key={i} className="h-9 w-24 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-5 xl:gap-6">
        {Array.from({ length: 8 }).map((_, i) => (
          <ListingCardSkeleton key={i} />
        ))}
      </div>
    </LoadingRegion>
  );
}
