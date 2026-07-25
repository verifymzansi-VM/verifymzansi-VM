import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

function ListingCardSkeleton() {
  return (
    <Card className="overflow-hidden rounded-xl">
      {/* 9:16 media frame — matches PosterCardShell */}
      <Skeleton className="aspect-[9/16] w-full rounded-none" />
      {/* Metadata row — avatar + two text lines, mirrors the real card */}
      <div className="flex gap-2.5 px-3 py-2.5">
        <Skeleton className="h-[30px] w-[30px] shrink-0 rounded-full" />
        <div className="flex-1 space-y-1.5 pt-0.5">
          <Skeleton className="h-3 w-4/5 rounded" />
          <Skeleton className="h-2.5 w-1/2 rounded" />
        </div>
      </div>
    </Card>
  );
}

export function ListingGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-5 xl:gap-6">
      {Array.from({ length: count }).map((_, i) => (
        <ListingCardSkeleton key={i} />
      ))}
    </div>
  );
}
