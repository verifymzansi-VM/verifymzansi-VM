import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

function ListingCardSkeleton() {
  return (
    <Card className="overflow-visible rounded-[20px] border-transparent bg-transparent shadow-none">
      {/* 9:16 media frame — matches PosterCardShell */}
      <Skeleton className="aspect-[9/16] w-full rounded-[20px]" />
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
