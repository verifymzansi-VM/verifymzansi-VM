"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Building2,
  Loader2,
  MapPin,
  Moon,
  Sun,
  ShoppingBag,
  SlidersHorizontal,
  TreePalm,
  X,
} from "lucide-react";
import { BrandShield } from "@/components/shared/brand-shield";
import { useViewerAppearance } from "@/components/providers/viewer-appearance";
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

const SECTIONS: { vertical: FeedVertical; short: string; icon: typeof ShoppingBag }[] = [
  { vertical: "market", short: "Market", icon: ShoppingBag },
  { vertical: "business", short: "Business", icon: Building2 },
  { vertical: "tourism", short: "Tourism & Events", icon: TreePalm },
];
const CONTROL =
  "viewer-tool flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[color:var(--viewer-border)] bg-[var(--viewer-surface)] text-[color:var(--viewer-foreground)] transition-colors hover:bg-[var(--viewer-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--viewer-accent)] disabled:opacity-60";
function ToolSlot({ children }: { children: ReactNode }) {
  return <div className="viewer-tool-slot">{children}</div>;
}
function ToolLabel({ children }: { children: ReactNode }) {
  return (
    <span className="viewer-tool-label" aria-hidden="true">
      {children}
    </span>
  );
}

const FIELD =
  "h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The site-wide "show my province first" preference, kept in step with the showrooms. */
export function rememberProvince(province: string | null) {
  try {
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${SHOWROOM_PROVINCE_COOKIE}=${encodeURIComponent(province ?? SHOWROOM_PROVINCE_ALL)}; path=/; max-age=${SHOWROOM_PROVINCE_MAX_AGE_SECONDS}; samesite=lax${secure}`;
  } catch {
    // A blocked cookie only means the choice is not remembered.
  }
}

export function FilterSheet({
  open,
  onOpenChange,
  browse,
  onApply,
  side = "right",
  withProvince = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  browse: FeedBrowse;
  onApply: (browse: FeedBrowse) => void;
  /** Phones: a bottom sheet that also holds the province choice. */
  side?: "right" | "bottom";
  withProvince?: boolean;
}) {
  const [draft, setDraft] = useState(browse);
  const ids = {
    q: useId(),
    province: useId(),
    category: useId(),
    condition: useId(),
    event: useId(),
    sort: useId(),
  };
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
      <SheetContent
        side={side}
        className={cn(
          "flex w-full flex-col gap-0 p-0",
          side === "bottom" ? "max-h-[85dvh] rounded-t-3xl pb-safe" : "sm:max-w-md"
        )}
      >
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle>Filter {VERTICAL_LABELS[draft.vertical]}</SheetTitle>
          <SheetDescription>
            {withProvince
              ? "Choose where and what to show."
              : `${draft.province ? `Posts in ${draft.province}.` : "Posts from all of South Africa."} Change the province using the location icon on the left.`}
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

          {withProvince ? (
            <div className="space-y-1.5">
              <label htmlFor={ids.province} className="text-sm font-medium">
                Province
              </label>
              <select
                id={ids.province}
                className={FIELD}
                value={draft.province ?? SHOWROOM_PROVINCE_ALL}
                onChange={(event) =>
                  set({
                    province:
                      event.target.value === SHOWROOM_PROVINCE_ALL ? null : event.target.value,
                  })
                }
              >
                <option value={SHOWROOM_PROVINCE_ALL}>All of South Africa</option>
                {getProvinceNames().map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

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
 * The viewer's compact side toolbar: the three sections, one province or the whole
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
  const appearance = useViewerAppearance();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const current = browse ?? defaultBrowse(activeVertical, null);
  const filterCount = browse ? activeFilterCount(browse) : 0;
  const provinces = getProvinceNames();

  return (
    <aside
      aria-label="Profile browsing tools"
      className="absolute inset-y-0 left-0 z-10 w-16 border-r border-[color:var(--viewer-border)] bg-[var(--viewer-background)]"
    >
      <div className="flex h-full flex-col items-center viewer-toolbar-items gap-3 py-3">
        <ToolSlot>
          <Link href="/" aria-label="VerifyMzansi home" className={CONTROL}>
            <span className="viewer-tool-icon">
              <BrandShield className="h-8 w-8" aria-hidden="true" />
            </span>
            <ToolLabel>VerifyMzansi home</ToolLabel>
          </Link>
        </ToolSlot>
        {!browse && sourceLabel ? <p className="sr-only">From {sourceLabel}</p> : null}
        {notice ? (
          <p className="sr-only" role="status">
            {notice}
          </p>
        ) : null}
        <nav
          aria-label="Sections"
          className="flex flex-col items-center gap-2 rounded-full border border-[color:var(--viewer-border)] bg-[var(--viewer-surface)] py-1"
        >
          {SECTIONS.map(({ vertical, short, icon: Icon }) => {
            const selected = current.vertical === vertical;
            return (
              <ToolSlot key={vertical}>
                <button
                  type="button"
                  aria-label={short}
                  aria-pressed={selected}
                  disabled={busy !== null}
                  onClick={() => onBrowse(defaultBrowse(vertical, current.province), "section")}
                  className={cn(
                    CONTROL,
                    "border-transparent",
                    selected &&
                      "bg-[var(--viewer-selected)] text-[color:var(--viewer-selected-text)] hover:bg-[var(--viewer-selected)]"
                  )}
                >
                  <span className="viewer-tool-icon">
                    {busy === "section" && selected ? (
                      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    )}
                  </span>
                  <ToolLabel>{VERTICAL_LABELS[vertical]}</ToolLabel>
                </button>
              </ToolSlot>
            );
          })}
        </nav>
        <ToolSlot>
          <div
            className={cn(
              CONTROL,
              "relative focus-within:ring-2 focus-within:ring-[color:var(--viewer-accent)]"
            )}
          >
            <span className="viewer-tool-icon">
              {busy === "province" ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              ) : (
                <MapPin className="h-5 w-5 text-[color:var(--viewer-accent)]" aria-hidden="true" />
              )}
            </span>
            <ToolLabel>{current.province ?? "All of South Africa"}</ToolLabel>
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
            {current.province ? (
              <span className="pointer-events-none absolute right-0 top-0 h-2 w-2 rounded-full bg-brand-gold-300" />
            ) : null}
          </div>
        </ToolSlot>
        <ToolSlot>
          <button
            type="button"
            className={cn(CONTROL, "relative")}
            onClick={() => setFiltersOpen(true)}
            disabled={busy !== null}
            aria-label={filterCount > 0 ? `Filters, ${filterCount} on` : "Filters"}
          >
            <span className="viewer-tool-icon">
              {busy === "filters" ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              ) : (
                <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
              )}
            </span>
            <ToolLabel>Filters</ToolLabel>
            {filterCount > 0 ? (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-gold-300 px-1 text-[11px] font-bold text-brand-gold-950">
                {filterCount}
              </span>
            ) : null}
          </button>
        </ToolSlot>
        <div className="mt-auto flex flex-col items-center gap-2">
          <ToolSlot>
            <button
              type="button"
              onClick={appearance?.toggle}
              className={CONTROL}
              aria-label={
                appearance?.theme === "light" ? "Switch to dark mode" : "Switch to light mode"
              }
            >
              <span className="viewer-tool-icon">
                {appearance?.theme === "light" ? (
                  <Moon className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <Sun className="h-5 w-5" aria-hidden="true" />
                )}
              </span>
              <ToolLabel>{appearance?.theme === "light" ? "Dark mode" : "Light mode"}</ToolLabel>
            </button>
          </ToolSlot>
          <ToolSlot>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close viewer"
              aria-keyshortcuts="Escape"
              className={CONTROL}
            >
              <span className="viewer-tool-icon">
                <X className="h-5 w-5" aria-hidden="true" />
              </span>
              <ToolLabel>Close viewer</ToolLabel>
            </button>
          </ToolSlot>
        </div>
      </div>
      {error ? (
        <p
          className="absolute left-[72px] top-2 z-20 w-64 rounded-xl bg-[var(--viewer-surface)] px-4 py-3 text-xs text-[color:var(--viewer-accent)] shadow-lg"
          role="alert"
        >
          Posts could not load. Try again.
        </p>
      ) : null}
      {filtersOpen ? (
        <FilterSheet
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          browse={current}
          onApply={(next) => {
            setFiltersOpen(false);
            onBrowse(next, "filters");
          }}
        />
      ) : null}
    </aside>
  );
}
