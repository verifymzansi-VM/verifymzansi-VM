"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * A row of status filters for an admin list, each with its count. "all"
 * counts every row; any other value counts the rows in that status.
 */
export function StatusFilterButtons<S extends string>({
  statuses,
  value,
  onChange,
  rows,
  label = "Filter by status",
}: {
  statuses: readonly S[];
  value: S;
  onChange: (status: S) => void;
  rows: readonly { status: string }[];
  label?: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      {statuses.map((status) => {
        const count =
          status === "all" ? rows.length : rows.filter((row) => row.status === status).length;
        return (
          <Button
            key={status}
            size="sm"
            variant={value === status ? "default" : "outline"}
            aria-pressed={value === status}
            onClick={() => onChange(status)}
            className="capitalize"
          >
            {status.replace(/_/g, " ")}
            <Badge variant="secondary" className="ml-1.5 text-[10px]">
              {count}
            </Badge>
          </Button>
        );
      })}
    </div>
  );
}
