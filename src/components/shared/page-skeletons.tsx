import type { ReactNode } from "react";

/** A single shimmering block. Decorative: the wrapping region announces loading. */
export function Bone({ className }: { className: string }) {
  return <div aria-hidden="true" className={`skeleton-shimmer ${className}`} />;
}

/** Stand-in for the sticky two-row site header while a route streams in. */
export function HeaderSkeleton() {
  return (
    <div aria-hidden="true" className="border-b border-border/60 bg-background">
      <div className="container-page flex h-16 items-center gap-4">
        <Bone className="h-8 w-32 rounded-lg sm:w-36" />
        <Bone className="hidden h-10 max-w-xl flex-1 rounded-full md:block" />
        <div className="ml-auto flex items-center gap-2">
          <Bone className="h-9 w-9 rounded-full" />
          <Bone className="h-10 w-24 rounded-full" />
        </div>
      </div>
      <div className="container-page hidden h-12 items-center gap-6 border-t border-border/40 md:flex">
        <Bone className="h-4 w-28 rounded-full" />
        <Bone className="h-4 w-32 rounded-full" />
        <Bone className="h-4 w-32 rounded-full" />
      </div>
    </div>
  );
}

/** Loading wrapper: one polite status region for the whole skeleton. */
export function LoadingRegion({
  label = "Loading",
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={className}>
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}

/** Breadcrumbs + title block used on detail pages. */
export function DetailTitleSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Bone className="h-3.5 w-3.5 rounded" />
        <Bone className="h-3.5 w-24 rounded-full" />
        <Bone className="h-3.5 w-32 rounded-full" />
      </div>
      <Bone className="h-8 w-4/5 max-w-lg rounded-lg sm:h-10" />
    </div>
  );
}

/** Sidebar card (poster, enquiry, safety tips) used on detail pages. */
export function SidebarCardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="surface-card space-y-3 p-5">
      <Bone className="h-3 w-20 rounded-full" />
      <div className="flex items-center gap-3">
        <Bone className="h-11 w-11 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2">
          <Bone className="h-4 w-28 rounded-full" />
          <Bone className="h-3.5 w-20 rounded-full" />
        </div>
      </div>
      {Array.from({ length: lines }).map((_, i) => (
        <Bone key={i} className={`h-3.5 rounded-full ${i === lines - 1 ? "w-2/3" : "w-full"}`} />
      ))}
      <Bone className="h-11 w-full rounded-xl" />
    </div>
  );
}
