import { Button } from "@/components/ui/button";

export function MarketplacePaginationControls({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-4">
      <Button
        variant="outline"
        size="sm"
        className="h-11 w-full sm:h-10 sm:w-auto"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </Button>

      <span className="sm:hidden text-xs text-muted-foreground">
        Page {page} of {totalPages}
      </span>

      <div className="hidden sm:flex items-center gap-1">
        {Array.from({ length: Math.min(totalPages, 5) }, (_, index) => {
          const pageNumber =
            totalPages <= 5
              ? index + 1
              : page <= 3
                ? index + 1
                : page >= totalPages - 2
                  ? totalPages - 4 + index
                  : page - 2 + index;

          return (
            <Button
              key={pageNumber}
              variant={pageNumber === page ? "default" : "ghost"}
              size="sm"
              className={`h-8 w-8 p-0 ${pageNumber === page ? "pointer-events-none" : ""}`}
              onClick={() => onPageChange(pageNumber)}
            >
              {pageNumber}
            </Button>
          );
        })}
      </div>

      <Button
        variant="outline"
        size="sm"
        className="h-11 w-full sm:h-10 sm:w-auto"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </Button>
    </div>
  );
}
