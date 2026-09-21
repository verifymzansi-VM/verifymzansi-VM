import { ChevronLeft, ChevronRight } from "lucide-react";
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
    <nav
      aria-label="Pagination"
      className="flex flex-col items-center justify-center gap-2 pt-6 sm:flex-row sm:gap-3"
    >
      <Button
        variant="outline"
        size="sm"
        className="h-11 w-full gap-1.5 rounded-full border-border/70 bg-card elev-xs transition-all hover:-translate-y-px hover:elev-sm sm:h-10 sm:w-auto sm:px-4"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeft className="h-4 w-4" />
        Previous
      </Button>

      <span className="text-xs font-medium text-muted-foreground sm:hidden">
        Page {page} of {totalPages}
      </span>

      <div className="hidden items-center gap-1 rounded-full border border-border/70 bg-muted/50 p-1 shadow-inner sm:flex">
        {Array.from({ length: Math.min(totalPages, 5) }, (_, index) => {
          const pageNumber =
            totalPages <= 5
              ? index + 1
              : page <= 3
                ? index + 1
                : page >= totalPages - 2
                  ? totalPages - 4 + index
                  : page - 2 + index;

          const isCurrent = pageNumber === page;
          return (
            <Button
              key={pageNumber}
              variant={isCurrent ? "default" : "ghost"}
              size="sm"
              className={`h-8 w-8 rounded-full p-0 transition-all ${
                isCurrent ? "pointer-events-none elev-xs" : "hover:bg-background"
              }`}
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
        className="h-11 w-full gap-1.5 rounded-full border-border/70 bg-card elev-xs transition-all hover:-translate-y-px hover:elev-sm sm:h-10 sm:w-auto sm:px-4"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
        <ChevronRight className="h-4 w-4" />
      </Button>
    </nav>
  );
}
