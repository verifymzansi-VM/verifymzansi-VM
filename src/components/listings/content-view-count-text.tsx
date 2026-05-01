"use client";

import { useEffect, useState } from "react";
import type { ContentTargetType } from "@/lib/engagement";

interface ContentViewRecordedDetail {
  targetId?: string;
  targetType?: ContentTargetType;
}

interface ContentViewCountTextProps {
  targetId: string;
  targetType: ContentTargetType;
  initialCount: number | null | undefined;
}

function formatViewCount(count: number) {
  return `${count} ${count === 1 ? "view" : "views"}`;
}

export function ContentViewCountText({
  targetId,
  targetType,
  initialCount,
}: ContentViewCountTextProps) {
  const [recordedViews, setRecordedViews] = useState<{
    targetId: string;
    targetType: ContentTargetType;
    count: number;
  } | null>(null);

  const liveRecordedCount =
    recordedViews?.targetId === targetId && recordedViews.targetType === targetType
      ? recordedViews.count
      : 0;
  const viewCount = (initialCount ?? 0) + liveRecordedCount;

  useEffect(() => {
    function handleRecorded(event: Event) {
      const detail = (event as CustomEvent<ContentViewRecordedDetail>).detail;
      if (detail?.targetId === targetId && detail.targetType === targetType) {
        setRecordedViews((current) => ({
          targetId,
          targetType,
          count:
            current?.targetId === targetId && current.targetType === targetType
              ? current.count + 1
              : 1,
        }));
      }
    }

    window.addEventListener("vmz:content-view-recorded", handleRecorded);
    return () => window.removeEventListener("vmz:content-view-recorded", handleRecorded);
  }, [targetId, targetType]);

  return <span>{formatViewCount(viewCount)}</span>;
}
