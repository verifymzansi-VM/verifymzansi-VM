"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

interface PhotoOrderListProps {
  files: File[];
  onReorder: (files: File[]) => void;
  /** Short line above the list. */
  hint?: string;
}

/** Lets posters move photos left/right; the first photo is the cover. */
export function PhotoOrderList({
  files,
  onReorder,
  hint = "Reorder photos. The first one is the cover.",
}: PhotoOrderListProps) {
  if (files.length < 2) return null;

  function move(from: number, to: number) {
    const reordered = [...files];
    [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
    onReorder(reordered);
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{hint}</p>
      <ol className="flex flex-wrap gap-2">
        {files.map((file, index) => (
          <li
            key={`${file.name}-${index}`}
            className="flex items-center gap-1 rounded-full border border-border bg-card py-0.5 pl-3 pr-0.5 text-xs"
          >
            <span className="mr-1 font-semibold text-muted-foreground">{index + 1}</span>
            <span className="max-w-[110px] truncate font-medium">{file.name}</span>
            <button
              type="button"
              disabled={index === 0}
              onClick={() => move(index, index - 1)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-foreground/70 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
              aria-label="Move photo left"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              disabled={index === files.length - 1}
              onClick={() => move(index, index + 1)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-foreground/70 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
              aria-label="Move photo right"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
