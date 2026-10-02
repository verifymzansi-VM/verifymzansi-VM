"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { ChevronDown, MapPin } from "lucide-react";
import { getProvinceNames } from "@/lib/constants/sa-provinces";
import {
  SHOWROOM_PROVINCE_ALL,
  SHOWROOM_PROVINCE_COOKIE,
  SHOWROOM_PROVINCE_MAX_AGE_SECONDS,
} from "@/lib/showroom/province-cookie";
import { cn } from "@/lib/utils";

/**
 * "Showing Gauteng first · Change". The province is estimated from the
 * connection, which mobile networks and VPNs can get wrong, so the visitor
 * can always pick another one (remembered in a functional cookie).
 */
export function ShowroomProvinceChip({
  province,
}: {
  province: string | null;
  source: "chosen" | "detected" | null;
}) {
  const router = useRouter();
  const selectId = useId();
  const [pending, startTransition] = useTransition();
  // Show the new choice at once; the server re-ranks the showroom meanwhile.
  const [selected, setSelected] = useState(province ?? SHOWROOM_PROVINCE_ALL);
  const shown = selected === SHOWROOM_PROVINCE_ALL ? null : selected;
  const provinces = getProvinceNames();

  const choose = (value: string) => {
    setSelected(value);
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${SHOWROOM_PROVINCE_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=${SHOWROOM_PROVINCE_MAX_AGE_SECONDS}; samesite=lax${secure}`;
    startTransition(() => router.refresh());
  };

  return (
    <div className="flex justify-center px-4 py-2.5">
      <div
        className={cn(
          "relative inline-flex h-9 max-w-full items-center gap-1.5 rounded-full px-3.5 text-xs font-medium",
          "border border-border/70 bg-card text-foreground shadow-xs",
          "focus-within:ring-2 focus-within:ring-brand-gold-400 focus-within:ring-offset-2 focus-within:ring-offset-transparent",
          pending && "opacity-70"
        )}
      >
        <MapPin
          className="h-3.5 w-3.5 shrink-0 text-brand-green-700 dark:text-brand-green-300"
          aria-hidden="true"
        />
        <span className="truncate">
          {shown ? (
            <>
              Showing <span className="font-semibold">{shown}</span> first
            </>
          ) : (
            "Showing all of South Africa"
          )}
        </span>
        <span className="shrink-0 text-slate-500 dark:text-white/60" aria-hidden="true">
          · Change
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />
        <label htmlFor={selectId} className="sr-only">
          Show posts from a province first
        </label>
        <select
          id={selectId}
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full opacity-0"
          value={selected}
          onChange={(event) => choose(event.target.value)}
          disabled={pending}
        >
          <option value={SHOWROOM_PROVINCE_ALL}>All of South Africa</option>
          {provinces.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
