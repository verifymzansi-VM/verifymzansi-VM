"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface CountdownBadgeProps {
  endDate: string;
  className?: string;
}

function getTimeRemaining(endDate: string) {
  const end = new Date(endDate).getTime();
  if (isNaN(end)) return null;
  const diff = end - Date.now();
  if (diff <= 0) return null;

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  if (days > 7) return null; // Only show countdown within 7 days
  if (days >= 1) return `${days}d ${hours}h left`;
  if (hours >= 1) return `${hours}h left`;
  return "Ends today";
}

export function CountdownBadge({ endDate, className }: CountdownBadgeProps) {
  const [label, setLabel] = useState<string | null>(() => getTimeRemaining(endDate));

  useEffect(() => {
    const update = () => setLabel(getTimeRemaining(endDate));
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [endDate]);

  if (!label) return null;

  const isUrgent = label === "Ends today" || label.includes("h left");

  return (
    <Badge
      className={`gap-1 text-[10px] font-semibold ${
        isUrgent
          ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200"
          : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
      } ${className ?? ""}`}
    >
      <Clock className="h-2.5 w-2.5" />
      {label}
    </Badge>
  );
}
