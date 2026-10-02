"use client";

import { useId, useState } from "react";
import Link from "next/link";
import {
  Building2,
  Loader2,
  MapPin,
  ShoppingBag,
  SlidersHorizontal,
  TreePalm,
  X,
} from "lucide-react";
import { BrandMark } from "@/components/brand";
import { SaFlagStripe } from "@/components/brand/sa-flag-stripe";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { getProvinceNames } from "@/lib/constants/sa-provinces";
import {
  activeFilterCount,
  browseOptions,
  cleanBrowseQuery,
  defaultBrowse,
  EVENT_TYPE_OPTIONS,
  VERTICAL_LABELS,
  type BrowseSort,
  type FeedBrowse,
  type TourismKind,
} from "@/lib/feed/browse";
import type { FeedVertical } from "@/lib/feed/types";
import {
  SHOWROOM_PROVINCE_ALL,
  SHOWROOM_PROVINCE_COOKIE,
  SHOWROOM_PROVINCE_MAX_AGE_SECONDS,
} from "@/lib/showroom/province-cookie";
import { cn } from "@/lib/utils";

const SECTIONS: {
  vertical: FeedVertical;
  short: string;
  icon: typeof ShoppingBag;
  iconClass: string;
}[] = [
  { vertical: "market", short: "Market", icon: ShoppingBag, iconClass: "text-brand-green-300" },
  { vertical: "business", short: "Business", icon: Building2, iconClass: "text-brand-blue-300" },
  { vertical: "tourism", short: "Tourism & Events", icon: TreePalm, iconClass: "text-teal-300" },
];

const CONTROL =
  "flex h-11 items-center gap-2 rounded-full border border-white/15 px-3.5 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300 disabled:opacity-60";
const FIELD =
  "h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The site-wide "show my province first" preference, kept in step with the showrooms. */
function rememberProvince(province: string | null) {
  try {
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${SHOWROOM_PROVINCE_COOKIE}=${encodeURIComponent(province ?? SHOWROOM_PROVINCE_ALL)}; path=/; max-age=${SHOWROOM_PROVINCE_MAX_AGE_SECONDS}; samesite=lax${secure}`;
  } catch {
    // A blocked cookie only means the choice is not remembered.
  }
}

function FilterSheet({
  open,
  onOpenChange,
  browse,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  browse: FeedBrowse;
  onApply: (browse: FeedBrowse) => void;
}) {
  const [draft, setDraft] = useState(browse);
  const ids = { q: useId(), category: useId(), condition: useId(), event: useId(), sort: useId() };
  const options = browseOptions(draft.vertical);
  const set = (patch: Partial<FeedBrowse>) => setDraft((current) => ({ ...current, ...patch }));

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(browse);
        onOpenChange(next);
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle>Filter {VERTICAL_LABELS[draft.vertical]}</SheetTitle>
          <SheetDescription>
            {draft.province ? `Posts in ${draft.province}.` : "Posts from all of South Africa."}{" "}
            Change the province in the top bar.
          </SheetDescription>
        </SheetHeader>

        <form
          className="flex-1 space-y-5 overflow-y-auto px-6 py-5"
          onSubmit={(event) => {
            event.preventDefault();
            onApply({ ...draft, query: cleanBrowseQuery(draft.query) });
          }}
          id="immersive-filters"
        >
          <div className="space-y-1.5">
            <label htmlFor={ids.q} className="text-sm font-medium">
              Search
            </label>
            <input
              id={ids.q}
              type="search"
              className={FIELD}
              value={draft.query ?? ""}
              maxLength={60}
              placeholder="e.g. BMW, braids, guest house"
              onChange={(event) => set({ query: event.target.value })}
            />
          </div>

          {draft.vertical === "tourism" ? (
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Show</legend>
              <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
                {(
                  [
                    ["all", "Everything"],
                    ["stays", "Stays and places"],
                    ["events", "Events"],
                  ] as [TourismKind, string][]
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center justify-center rounded-lg px-2 text-center text-xs font-semibold transition-colors focus-within:ring-2 focus-within:ring-ring",
                      draft.kind === value ? "bg-background shadow-sm" : "text-muted-foreground"
                    )}
                  >
                    <input
                      type="radio"
                      name="kind"
                      value={value}
                      checked={draft.kind === value}
                      onChange={() =>
                        set({
                          kind: value,
                          category: value === "events" ? null : draft.category,
                          eventType: value === "stays" ? null : draft.eventType,
                        })
                      }
                      className="sr-only"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {draft.vertical !== "tourism" || draft.kind !== "events" ? (
            <div className="space-y-1.5">
              <label htmlFor={ids.category} className="text-sm font-medium">
                {draft.vertical === "tourism" ? "Type of stay or place" : "Category"}
              </label>
              <select
                id={ids.category}
                className={FIELD}
                value={draft.category ?? ""}
                onChange={(event) =>
                  set({
                    category: event.target.value || null,
                    ...(draft.vertical === "tourism" && event.target.value
                      ? { kind: "stays" as const, eventType: null }
                      : {}),
                  })
                }
              >
                <option value="">All</option>
                {options.categories.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {draft.vertical === "tourism" && draft.kind !== "stays" ? (
            <div className="space-y-1.5">
              <label htmlFor={ids.event} className="text-sm font-medium">
                Type of event
              </label>
              <select
                id={ids.event}
                className={FIELD}
                value={draft.eventType ?? ""}
                onChange={(event) =>
                  set({
                    eventType: event.target.value || null,
                    ...(event.target.value ? { kind: "events" as const, category: null } : {}),
                  })
                }
              >
                <option value="">All events</option>
                {EVENT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {options.conditions.length > 0 ? (
            <div className="space-y-1.5">
              <label htmlFor={ids.condition} className="text-sm font-medium">
                Condition
              </label>
              <select
                id={ids.condition}
                className={FIELD}
                value={draft.condition ?? ""}
                onChange={(event) => set({ condition: event.target.value || null })}
              >
                <option value="">Any condition</option>
                {options.conditions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label htmlFor={ids.sort} className="text-sm font-medium">
              Order
            </label>
            <select
              id={ids.sort}
              className={FIELD}
              value={draft.sort}
              onChange={(event) => set({ sort: event.target.value as BrowseSort })}
            >
              {options.sorts.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </form>

        <SheetFooter className="flex-row gap-3 border-t px-6 py-4">
          <button
            type="button"
            className="h-11 flex-1 rounded-full border px-4 text-sm font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onApply(defaultBrowse(draft.vertical, draft.province))}
          >
            Clear filters
          </button>
          <button
            type="submit"
            form="immersive-filters"
            className="h-11 flex-1 rounded-full bg-brand-green-700 px-4 text-sm font-semibold text-white hover:bg-brand-green-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Show posts
          </button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/**
 * The viewer's own top bar: the three sections, one province or the whole
 * country, and the section's filters. Every choice reloads the posts here,
 * in the viewer; nothing navigates away.
 */
export function ImmersiveTopBar({
  browse,
  activeVertical,
  sourceLabel,
  busy,
  error,
  notice,
  onBrowse,
  onClose,
}: {
  /** The current browse, or null while following a list from another page. */
  browse: FeedBrowse | null;
  /** Section of the post on screen (used when not browsing). */
  activeVertical: FeedVertical;
  sourceLabel: string;
  busy: "section" | "province" | "filters" | null;
  error: boolean;
  notice: string | null;
  onBrowse: (browse: FeedBrowse, cause: "section" | "province" | "filters") => void;
  onClose: () => void;
}) {
  const provinceId = useId();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const current = browse ?? defaultBrowse(activeVertical, null);
  const filterCount = browse ? activeFilterCount(browse) : 0;
  const provinces = getProvinceNames();

  return (
    <header className="relative z-10 shrink-0">
      <div className="grid h-[60px] grid-cols-[1fr_auto_1fr] items-center gap-4 px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/"
            className="shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300"
            aria-label="VerifyMzansi home"
          >
            <BrandMark
              size="sm"
              inverse
              hideKicker
              decorative
              className="[&_img]:!h-8 [&_img]:!w-8"
            />
          </Link>
          {/* A list followed from another page (a grid, a showroom) is named here. */}
          {!browse && sourceLabel ? (
            <p className="hidden truncate text-sm text-white/65 xl:block">
              From <span className="font-semibold text-white">{sourceLabel}</span>
            </p>
          ) : null}
          {notice ? (
            <p className="hidden truncate text-xs text-white/70 xl:block" role="status">
              {notice}
            </p>
          ) : null}
        </div>

        <nav
          aria-label="Sections"
          className="flex items-center gap-1 rounded-full border border-white/10 bg-brand-green-900/80 p-1"
        >
          {SECTIONS.map(({ vertical, short, icon: Icon, iconClass }) => {
            const selected = current.vertical === vertical;
            return (
              <button
                key={vertical}
                type="button"
                aria-pressed={selected}
                disabled={busy !== null}
                onClick={() => onBrowse(defaultBrowse(vertical, current.province), "section")}
                className={cn(
                  "flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300",
                  selected
                    ? "bg-white text-brand-green-950"
                    : "text-white/80 hover:bg-white/10 hover:text-white"
                )}
              >
                {busy === "section" && selected ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Icon
                    className={cn("h-4 w-4", selected ? "text-brand-green-700" : iconClass)}
                    aria-hidden="true"
                  />
                )}
                <span className="xl:hidden">{short}</span>
                <span className="hidden xl:inline">{VERTICAL_LABELS[vertical]}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex items-center justify-end gap-2">
          {error ? (
            <p className="hidden text-xs text-brand-gold-300 xl:block" role="alert">
              Posts could not load. Try again.
            </p>
          ) : null}
          <div
            className={cn(
              CONTROL,
              "relative max-w-[10.5rem] xl:max-w-[13rem] focus-within:ring-2 focus-within:ring-brand-gold-300"
            )}
          >
            {busy === "province" ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
            ) : (
              <MapPin className="h-4 w-4 shrink-0 text-brand-gold-300" aria-hidden="true" />
            )}
            <span className="truncate">{current.province ?? "All of South Africa"}</span>
            <label htmlFor={provinceId} className="sr-only">
              Show posts from
            </label>
            <select
              id={provinceId}
              className="absolute inset-0 cursor-pointer appearance-none rounded-full opacity-0"
              value={current.province ?? SHOWROOM_PROVINCE_ALL}
              disabled={busy !== null}
              onChange={(event) => {
                const province =
                  event.target.value === SHOWROOM_PROVINCE_ALL ? null : event.target.value;
                rememberProvince(province);
                onBrowse({ ...current, province }, "province");
              }}
            >
              <option value={SHOWROOM_PROVINCE_ALL}>All of South Africa</option>
              {provinces.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className={cn(CONTROL, "relative")}
            onClick={() => setFiltersOpen(true)}
            disabled={busy !== null}
            aria-label={filterCount > 0 ? `Filters, ${filterCount} on` : "Filters"}
            title="Filters"
          >
            {busy === "filters" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="hidden 2xl:inline">Filters</span>
            {filterCount > 0 ? (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-gold-300 px-1 text-[11px] font-bold text-brand-gold-950">
                {filterCount}
              </span>
            ) : null}
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close viewer"
            aria-keyshortcuts="Escape"
            title="Close (Esc)"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>
      <SaFlagStripe className="h-0.5 opacity-80" />

      <FilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        browse={current}
        onApply={(next) => {
          setFiltersOpen(false);
          onBrowse(next, "filters");
        }}
      />
    </header>
  );
}
