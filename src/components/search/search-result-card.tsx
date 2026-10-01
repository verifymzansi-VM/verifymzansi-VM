"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { CalendarDays, MapPin } from "lucide-react";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { cn } from "@/lib/utils";
import type { SearchArea } from "./search-sources";

export interface SearchResultCardData {
  id: string;
  href: string;
  title: string;
  description?: string;
  imageUrl?: string;
  /** Category or post type, shown above the title. */
  eyebrow?: string;
  price?: string;
  negotiable?: boolean;
  location?: string;
  /** Event start date, already formatted. */
  date?: string;
}

const EYEBROW_TONE: Record<SearchArea["tone"], string> = {
  market: "text-brand-green-700 dark:text-brand-green-300",
  business: "text-brand-blue-700 dark:text-brand-blue-300",
  tourism: "text-teal-700 dark:text-teal-300",
};

function ResultThumbnail({ src, area }: { src?: string; area: SearchArea }) {
  const [failed, setFailed] = useState(false);
  const Icon = area.icon;
  if (!src || failed) {
    return (
      <div
        aria-hidden="true"
        className={cn("flex h-full w-full items-center justify-center", area.tileClassName)}
      >
        <Icon className="h-7 w-7 opacity-80" />
      </div>
    );
  }
  return (
    <Image
      src={normalizeMediaUrl(src)}
      alt=""
      fill
      sizes="(min-width: 1280px) 280px, (min-width: 640px) 45vw, 96px"
      className="object-contain transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Search result card: thumbnail first, then category, title, price or date,
 * and location. The title link stretches over the whole card so the link's
 * accessible name stays the post title.
 */
export function SearchResultCard({ item, area }: { item: SearchResultCardData; area: SearchArea }) {
  return (
    <article className="group relative flex h-full gap-3 rounded-2xl border border-border/70 bg-card p-2.5 elev-xs transition-[border-color,box-shadow] duration-200 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background hover:border-foreground/20 hover:elev-sm sm:flex-col sm:gap-0 sm:overflow-hidden sm:p-0">
      <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-muted sm:aspect-[4/3] sm:h-auto sm:w-full sm:rounded-none">
        <ResultThumbnail src={item.imageUrl} area={area} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col py-0.5 sm:px-3.5 sm:pb-3.5 sm:pt-3">
        {item.eyebrow ? (
          <p className={cn("truncate text-xs font-semibold", EYEBROW_TONE[area.tone])}>
            {item.eyebrow}
          </p>
        ) : null}
        <h3 className="mt-0.5 line-clamp-2 break-words font-body text-[15px] font-semibold leading-snug text-foreground">
          <Link
            prefetch={false}
            href={item.href}
            className="after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none"
          >
            {item.title}
          </Link>
        </h3>
        {item.price || item.date ? (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
            {item.price ? (
              <span className="font-bold text-foreground">
                {item.price}
                {item.negotiable ? (
                  <span className="ml-1.5 text-xs font-medium text-muted-foreground">
                    Negotiable
                  </span>
                ) : null}
              </span>
            ) : null}
            {item.date ? (
              <span className="inline-flex items-center gap-1 font-medium text-foreground/80">
                <CalendarDays aria-hidden="true" className="h-3.5 w-3.5" />
                {item.date}
              </span>
            ) : null}
          </p>
        ) : item.description ? (
          <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-muted-foreground">
            {item.description}
          </p>
        ) : null}
        {item.location ? (
          <p className="mt-auto flex items-center gap-1 pt-1.5 text-xs text-muted-foreground">
            <MapPin aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{item.location}</span>
          </p>
        ) : null}
      </div>
    </article>
  );
}

/** Skeleton shaped like SearchResultCard (row on phones, tile from `sm`). */
export function SearchResultCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex gap-3 rounded-2xl border border-border/60 bg-card p-2.5 sm:flex-col sm:gap-0 sm:overflow-hidden sm:p-0"
    >
      <div className="skeleton-shimmer h-24 w-24 shrink-0 rounded-xl sm:aspect-[4/3] sm:h-auto sm:w-full sm:rounded-none" />
      <div className="flex-1 space-y-2 py-1 sm:px-3.5 sm:pb-4 sm:pt-3">
        <div className="skeleton-shimmer h-3 w-1/3 rounded-full" />
        <div className="skeleton-shimmer h-4 w-4/5 rounded-full" />
        <div className="skeleton-shimmer h-3.5 w-1/4 rounded-full" />
        <div className="skeleton-shimmer h-3 w-1/2 rounded-full" />
      </div>
    </div>
  );
}
