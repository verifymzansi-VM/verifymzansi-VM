import { Skeleton } from "@/components/ui/skeleton";

export function MarketplacePreviewsSkeleton() {
  return (
    <div className="space-y-6">
      {Array.from({ length: 3 }).map((_, sectionIdx) => (
        <div key={sectionIdx} className="space-y-4">
          <div className="flex items-baseline justify-between">
            <div className="space-y-1.5">
              <Skeleton className="h-5 w-32 rounded-full" />
              <Skeleton className="h-3 w-16 rounded-full" />
            </div>
            <Skeleton className="h-4 w-16 rounded-full" />
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, cardIdx) => (
              <div key={cardIdx} className="space-y-2">
                <Skeleton className="aspect-[9/16] rounded-[20px]" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
