import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export function ListingCardSkeleton() {
  return (
    <Card className="overflow-hidden rounded-[1.75rem]">
      <div className="relative aspect-[4/5] w-full">
        <Skeleton className="h-full w-full" />
        <div className="absolute inset-x-0 bottom-0 space-y-2 p-4">
          <Skeleton className="h-5 w-24 bg-white/30" />
          <Skeleton className="h-5 w-3/4 bg-white/20" />
          <Skeleton className="h-4 w-1/2 bg-white/20" />
        </div>
      </div>
    </Card>
  );
}

export function ListingGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <ListingCardSkeleton key={i} />
      ))}
    </div>
  );
}
