import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

function ListingCardSkeleton({ index = 0 }: { index?: number }) {
  return (
    <Card
      className="overflow-visible rounded-[20px] border-transparent bg-transparent shadow-none motion-safe:animate-in motion-safe:fade-in motion-safe:fill-mode-both"
      style={{ animationDelay: `${Math.min(index * 60, 420)}ms` }}
    >
      {/* 9:16 media frame — matches PosterCardShell */}
      <Skeleton className="aspect-[9/16] w-full rounded-[20px]" />
      {/* Metadata row beneath the media frame */}
      <div className="flex items-start gap-2 px-0.5 pt-2.5">
        <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
          <Skeleton className="h-3.5 w-2/5 rounded-full" />
          <Skeleton className="h-3 w-11/12 rounded-full" />
          <Skeleton className="h-2.5 w-1/2 rounded-full" />
        </div>
      </div>
    </Card>
  );
}

export function ListingGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-5 xl:gap-6"
      aria-busy="true"
      aria-label="Loading results"
    >
      {Array.from({ length: count }).map((_, i) => (
        <ListingCardSkeleton key={i} index={i} />
      ))}
    </div>
  );
}
