"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function MobilePostSticker() {
  const pathname = usePathname();
  const isActive = pathname.startsWith("/post/create");
  const hasNearbyFilterFab =
    pathname.startsWith("/mzansi-market") ||
    pathname.startsWith("/mzansi-business") ||
    pathname.startsWith("/promotions");

  return (
    <div
      className={cn(
        "pointer-events-none fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[60]",
        hasNearbyFilterFab ? "left-4 right-auto" : "right-4"
      )}
    >
      <Link
        href="/post/create"
        aria-current={isActive ? "page" : undefined}
        aria-label="Post+"
        className={cn(
          "pointer-events-auto inline-flex min-h-[42px] items-center justify-center rounded-full border px-4 py-2 text-sm font-extrabold shadow-lg transition-all",
          isActive
            ? "border-brand-green-700 bg-brand-green-700 text-white"
            : "border-brand-green/25 bg-brand-green text-white hover:bg-brand-green-600"
        )}
      >
        Post+
      </Link>
    </div>
  );
}
