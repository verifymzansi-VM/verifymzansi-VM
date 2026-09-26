"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface HeaderSearchProps {
  className?: string;
  /** Visual size: the header uses the compact field, the homepage hero the large one. */
  size?: "default" | "lg";
  placeholder?: string;
  autoFocus?: boolean;
}

/**
 * Site-wide search field. A plain GET form to /search keeps it working before
 * hydration and without JavaScript; the site search page fans the query out to
 * Mzansi Market, businesses, tourism, events and help pages.
 */
export function HeaderSearch({
  className,
  size = "default",
  placeholder = "Search phones, plumbers, stays, events…",
  autoFocus = false,
}: HeaderSearchProps) {
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);
  const isLarge = size === "lg";

  // Mirror the active query on the results page. Read from location rather than
  // useSearchParams so statically rendered pages need no Suspense boundary.
  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.value =
      pathname === "/search" ? (new URLSearchParams(window.location.search).get("q") ?? "") : "";
  }, [pathname]);

  return (
    <form
      action="/search"
      method="get"
      role="search"
      aria-label="Search VerifyMzansi"
      className={cn("group relative w-full", className)}
      onSubmit={(event) => {
        if (!inputRef.current?.value.trim()) {
          event.preventDefault();
          inputRef.current?.focus();
        }
      }}
    >
      <label htmlFor={isLarge ? "hero-search" : "header-search"} className="sr-only">
        Search VerifyMzansi
      </label>
      <Search
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-foreground",
          isLarge ? "left-5 h-5 w-5" : "left-3.5 h-4 w-4"
        )}
      />
      <input
        ref={inputRef}
        id={isLarge ? "hero-search" : "header-search"}
        type="search"
        name="q"
        maxLength={100}
        autoComplete="off"
        enterKeyHint="search"
        autoFocus={autoFocus}
        placeholder={placeholder}
        className={cn(
          "w-full rounded-full border border-border bg-muted/60 text-foreground transition-all duration-200 placeholder:text-muted-foreground/80 hover:border-foreground/20 hover:bg-card focus:border-brand-green/50 focus:bg-card focus:outline-none focus:ring-4 focus:ring-brand-green/15 [&::-webkit-search-cancel-button]:hidden",
          isLarge
            ? "h-14 bg-card pl-[3.25rem] pr-28 text-base shadow-lg shadow-black/5 sm:h-16 sm:pr-32 sm:text-[17px]"
            : "h-10 pl-10 pr-4 text-sm"
        )}
      />
      {isLarge ? (
        <button
          type="submit"
          className="absolute right-2 top-1/2 inline-flex h-10 -translate-y-1/2 items-center gap-2 rounded-full bg-brand-green-600 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-12 sm:px-6 dark:bg-brand-green-500 dark:text-brand-green-950 dark:hover:bg-brand-green-400"
        >
          Search
        </button>
      ) : null}
    </form>
  );
}
