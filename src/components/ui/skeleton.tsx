import * as React from "react";
import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className={cn("rounded-md skeleton-shimmer", className)}
      {...props}
    />
  );
}

export { Skeleton };
